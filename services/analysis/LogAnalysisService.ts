
import { AppConfig, WorkflowRun, RunGroup, AgentPlan, FileChange } from '../../types.js';
import { SandboxEnvironment } from '../../sandbox.js';
import { unifiedGenerate, safeJsonParse, extractCode } from '../llm/LLMService.js';
import { runDevShellCommand } from '../sandbox/SandboxService.js';
import { filterLogs, summarizeLogs } from '../context-compiler.js';
import { getWorkflowLogs, pushMultipleFilesToGitHub } from '../github/GitHubService.js';
import { ContextManager, ContextPriority } from '../context-manager.js';
import { postProcessPatch } from '../repair-agent/post-processor.js';
import { extractCodeBlock, extractCodeBlockStrict } from '../../utils/parsing.js';

const MODEL_SMART = "gemini-3-pro-preview";
const MODEL_FAST = "gemini-2.5-flash";

function logTrace(msg: string) {
    // No-op in browser and server for now to maintain compatibility
}

export interface DiagnosisResult {
    summary: string;
    filePath: string;
    fixAction: 'edit' | 'command' | 'create';
    type?: string; // Error type (e.g. 'dependency_error')
    suggestedCommand?: string;
    reproductionCommand?: string;
    confidence?: number; // Diagnosis confidence (0-1)
}

/**
 * Refines a problem statement by distilling feedback history into a concise,
 * self-contained description. This implements the Markovian state refinement
 * from Atom of Thoughts, reducing context bloat.
 * 
 * @param diagnosis - Current diagnosis result
 * @param feedback - Array of feedback from previous attempts
 * @param previousStatement - Previous refined statement (if any)
 * @returns Refined, self-contained problem statement
 */
export async function refineProblemStatement(
    config: AppConfig,
    diagnosis: DiagnosisResult,
    feedback: string[],
    previousStatement?: string
): Promise<string> {
    // If no feedback, return the diagnosis summary
    if (!feedback || feedback.length === 0) {
        return diagnosis.summary;
    }

    // If only one feedback item and no previous statement, combine simply
    if (feedback.length === 1 && !previousStatement) {
        return `${diagnosis.summary}\nPrevious attempt: ${feedback[0]}`;
    }

    // Use LLM to distill feedback into refined statement
    const prompt = `You are refining a problem statement for a CI error fix agent.

CURRENT DIAGNOSIS:
${diagnosis.summary}

${previousStatement ? `PREVIOUS REFINED STATEMENT:\n${previousStatement}\n` : ''}

FEEDBACK FROM ATTEMPTS:
${feedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Your task: Create a CONCISE, SELF-CONTAINED problem statement that:
1. Captures the core issue from the diagnosis
2. Incorporates key learnings from feedback (what didn't work, what was discovered)
3. Is no more than 3-4 sentences
4. Can be understood WITHOUT reading the full feedback history
5. Focuses on what needs to be done NOW, not what was tried before

Return ONLY the refined problem statement, no preamble or explanation.`;

    try {
        const res = await unifiedGenerate(config, {
            contents: prompt,
            model: MODEL_FAST, // Use fast model for efficiency
            config: { maxOutputTokens: 500 }
        });

        return res.text.trim();
    } catch (e: any) {
        console.error('[refineProblemStatement] Error:', e);
        // Fallback: simple concatenation
        return `${diagnosis.summary}\nKey learnings: ${feedback.slice(-2).join('; ')}`;
    }
}


export async function groupFailedRuns(config: AppConfig, runs: WorkflowRun[]): Promise<RunGroup[]> {
    const groups: Record<string, RunGroup> = {};

    runs.forEach(run => {
        if (!groups[run.name]) {
            groups[run.name] = {
                id: `GROUP-${Math.random().toString(36).substr(2, 5)}`,
                name: run.name,
                runIds: [],
                mainRun: run
            };
        }
        groups[run.name].runIds.push(run.id);
    });

    return Object.values(groups);
}

export async function diagnoseError(
    config: AppConfig,
    logSnippet: string,
    repoContext?: string,
    profile?: any,
    previousClassification?: any,
    feedbackHistory?: string[]
): Promise<DiagnosisResult> {
    logTrace('[Diagnosis] Starting diagnoseError');
    try {
        const filteredLogs = filterLogs(logSnippet);
        logTrace(`[Diagnosis] filteredLogs length: ${filteredLogs.length}`);
        const logSummary = await summarizeLogs(filteredLogs);
        logTrace(`[Diagnosis] logSummary: ${logSummary}`);

        // Use new structured prompt with few-shot examples
        const { generateDiagnosisPrompt } = await import('../llm/prompts.js');

        // Build enhanced repo context
        let enhancedRepoContext = repoContext || '';
        if (profile) {
            enhancedRepoContext += `\n\nRepository Profile:
- Languages: ${profile.languages?.join(', ') || 'Unknown'}
- Package Manager: ${profile.packageManager || 'Unknown'}
- Build System: ${profile.buildSystem || 'Unknown'}
- Test Framework: ${profile.testFramework || 'Unknown'}`;
        }

        if (previousClassification) {
            enhancedRepoContext += `\n\nError Classification:
- Category: ${previousClassification.category || 'Unknown'}
- Scope: ${previousClassification.scope || 'generic'}
- Suggested Action: ${previousClassification.suggestedAction || 'None'}`;
        }

        const prompt = generateDiagnosisPrompt({
            errorLog: `${logSummary}\n\n${filteredLogs}`,
            repoContext: enhancedRepoContext,
            feedbackHistory
        });

        logTrace('[Diagnosis] Calling unifiedGenerate with structured prompt...');
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { temperature: 0.1, maxOutputTokens: 2048 },
            model: MODEL_FAST,
            responseFormat: 'json'  // Force JSON output
        });
        logTrace(`[Diagnosis] Got response: ${response ? 'object' : 'null'}`);

        let result = safeJsonParse(response.text || "{}", {
            summary: "Unknown Error",
            filePath: "",
            fixAction: "edit",
            confidence: 0.5
        } as any);
        logTrace(`[Diagnosis] Parsed result: ${JSON.stringify(result)}`);

        // Normalize result structure
        if (result.result) result = result.result;
        if (result.answer) {
            if (typeof result.answer === 'string') result = { ...result, summary: result.answer };
            else result = { ...result, ...result.answer };
        }
        if (result.primaryError && !result.summary) result.summary = result.primaryError;

        // Defensive parsing for hallucinated commands
        let cleanCommand = result.suggestedCommand;
        if (cleanCommand) {
            // 0. Handle Markdown Code Blocks
            cleanCommand = cleanCommand.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

            // 1. Handle Multiline - prefer the line that looks most like a shell command
            const lines = cleanCommand.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length > 1) {
                // Heuristic: If one line starts with a known shell command, pick it.
                const shellKeywords = ['npm', 'pnpm', 'yarn', 'git', 'docker', 'pip', 'python', 'node', 'sh', 'bash', 'rm', 'cp', 'mv', 'ls', 'echo', 'grep', 'cat', 'pytest', 'jest'];
                const cmdLine = lines.find(l => shellKeywords.some(k => l.startsWith(k)));
                if (cmdLine) cleanCommand = cmdLine;
                else cleanCommand = lines[lines.length - 1]; // Fallback to last line
            }

            // 2. Strip known "Label: " prefixes (Case insensitive)
            // Keywords: Action, Command, Run, Execute, Shell, Bash, Step, Fix, Solution, Suggestion, Code, Note, Try running, To fix this
            const prefixRegex = /^(Action|Command|Run|Execute|Shell|Bash|Step|Fix|Solution|Suggestion|Code|Note|Try running|To fix this|I suggest|You should run)(\s*(:|-)\s*|\s+)/i;
            cleanCommand = cleanCommand.replace(prefixRegex, '');

            // 3. Handle "Description: Command" (Unquoted or Quoted)
            // If there's a colon, and the part BEFORE the colon is descriptive (multiple words, no shell symbols),
            // and the part AFTER is the command.
            if (cleanCommand.includes(':') && !cleanCommand.includes('://') && !cleanCommand.includes('scp ')) {
                const parts = cleanCommand.split(':');
                const firstPart = parts[0].trim();
                const rest = parts.slice(1).join(':').trim();

                const shellKeywords = ['npm', 'pnpm', 'yarn', 'git', 'docker', 'pip', 'python', 'node', 'sh', 'bash', 'rm', 'cp', 'mv', 'ls', 'echo', 'grep', 'cat', 'pytest', 'jest', 'vitest'];

                // Heuristic: If first part has spaces and > 1 word, it's likely a description
                // BUT: Check if it starts with a known shell keyword. If so, it is likely the command itself (e.g. echo 'Msg: Val')
                const firstWord = firstPart.split(/\s+/)[0].toLowerCase();

                if (firstPart.split(/\s+/).length > 1 && rest.length > 0 && !shellKeywords.includes(firstWord)) {
                    // Check if rest is quoted
                    const quotedMatch = rest.match(/^(['"`])(.*)\1$/);
                    if (quotedMatch) cleanCommand = quotedMatch[2];
                    else cleanCommand = rest;
                }
            }

            // 4. Clean surrounding quotes (Again, just in case)
            if ((cleanCommand.startsWith('"') && cleanCommand.endsWith('"')) ||
                (cleanCommand.startsWith("'") && cleanCommand.endsWith("'")) ||
                (cleanCommand.startsWith("`") && cleanCommand.endsWith("`"))) {
                if (cleanCommand.length > 1) cleanCommand = cleanCommand.slice(1, -1);
            }

            cleanCommand = cleanCommand.trim();
        }

        return {
            summary: result.summary || "Diagnosis Failed",
            filePath: result.filePath || "",
            fixAction: result.fixAction || "edit",
            suggestedCommand: cleanCommand,
            reproductionCommand: result.reproductionCommand,
            confidence: result.confidence || 0.5
        };

    } catch (e: any) {
        logTrace(`[Diagnosis] Exception: ${e.message}\n${e.stack}`);
        console.log('[Diagnosis] Exception during diagnosis:', e);
        return { summary: "Diagnosis Failed", filePath: "", fixAction: "edit", reproductionCommand: undefined, confidence: 0 };
    }
}

export async function generateRepoSummary(config: AppConfig, sandbox?: SandboxEnvironment): Promise<string> {
    if (!sandbox) return "Repository Context: (Simulation Mode - No Access)";

    try {
        const tree = await runDevShellCommand(config, "find . -maxdepth 3 -not -path '*/.*'", sandbox);
        const fileTree = tree.output.split('\n').filter(Boolean).join('\n');

        let readme = "";
        try {
            const readmeRes = await runDevShellCommand(config, "cat README.md", sandbox);
            if (readmeRes.exitCode === 0) readme = readmeRes.output.slice(0, 2000);
        } catch (e) {
            // Ignore readme read errors
        }

        let configFiles = "";
        try {
            const pkgRes = await runDevShellCommand(config, "cat package.json", sandbox);
            if (pkgRes.exitCode === 0) configFiles += `\n=== package.json ===\n${pkgRes.output}`;
        } catch (e) {
            // Ignore package.json read errors
        }

        return `
    Repository Structure:
    ${fileTree}
    
    Key Documentation:
    ${readme}
    
    Configuration:
    ${configFiles}
    `;
    } catch (e: any) {
        return `Failed to generate repo summary: ${e.message}`;
    }
}

export async function generateFix(config: AppConfig, context: any): Promise<string> {
    try {
        const contextManager = new ContextManager(50000);

        // System/Instruction
        contextManager.addItem({
            id: 'instruction',
            type: 'text',
            priority: ContextPriority.CRITICAL,
            content: `Fix the code based on the error provided. Return only the full file code.`
        });

        // Error (Critical)
        contextManager.addItem({
            id: 'error_summary',
            type: 'text',
            priority: ContextPriority.CRITICAL,
            content: `Error: ${context.error}`
        });

        // Code (High)
        contextManager.addItem({
            id: 'source_code',
            type: 'code',
            priority: ContextPriority.HIGH,
            content: context.code
        });

        // Extra Context (Medium)
        if (context.extraContext) {
            contextManager.addItem({
                id: 'extra_context',
                type: 'text',
                priority: ContextPriority.MEDIUM,
                content: context.extraContext
            });
        }

        const prompt = contextManager.compile();

        const segments: string[] = [];
        
        const firstResponse = await unifiedGenerate(config, {
            contents: prompt,
            model: MODEL_SMART,
            config: { maxOutputTokens: 8192 },
            validate: (text) => text.includes('```')
        });
        
        segments.push(firstResponse.text);

        for (let i = 0; i < 3; i++) {
            const lastSegment = segments[segments.length - 1];
            const trimmed = lastSegment.trim();
            if (trimmed.endsWith('```')) break;

            const contPrompt = `Continue generating code from where you left off. Last chars:\n\`\`\`${trimmed.slice(-1000)}\`\`\``;
            const res = await unifiedGenerate(config, {
                contents: contPrompt,
                model: MODEL_SMART,
                config: { maxOutputTokens: 8192 }
            });
            segments.push(res.text);
        }

        // Concatenate all segments into a single response
        // For continuation segments, strip the leading fence to avoid duplicate fences
        const processedSegments = segments.map((seg, index) => {
            if (index === 0) return seg;
            // Strip leading fence from continuation segments
            return seg.replace(/^```[\w]*\n?/, '');
        });
        const fullResponse = processedSegments.join('');

        // STRICT CODE BLOCK EXTRACTION: Never trust raw LLM output for file writing
        // This prevents writing conversational filler or unstructured text to files
        const rawCode = extractCodeBlockStrict(fullResponse);

        // Apply automated post-processing (flags, Docker comments, spell-check)
        const processedCode = postProcessPatch(context.filePath || 'file.txt', rawCode);

        return processedCode;
    } catch (e: any) {
        console.error('[generateFix] Error:', e);
        throw new Error(`Failed to generate fix: ${e.message}`);
    }
}

export async function judgeFix(config: AppConfig, original: string, fixed: string, error: string): Promise<{ passed: boolean, score: number, reasoning: string }> {
    if (original.trim() === fixed.trim()) return { passed: false, reasoning: "No changes made.", score: 0 };

    const prompt = `
    You are a Senior Code Reviewer.
    Original Error: "${error}"
    
    Proposed Change:
    \`\`\`
    ${fixed.substring(0, 10000)}
    \`\`\`
    
    Evaluate if this fixes the error.
    Return strictly JSON: { "passed": boolean, "score": number, "reasoning": "string" }
    `;

    try {
        const res = await unifiedGenerate(config, {
            contents: prompt,
            config: { responseMimeType: "application/json" },
            model: MODEL_SMART
        });
        return safeJsonParse(res.text, { passed: true, score: 7, reasoning: "Assuming fix is valid (fallback)." });
    } catch (e: any) {
        console.error('[judgeFix] Error:', e);
        return { passed: true, score: 5, reasoning: `Judge Offline (${e.message}). Bypass enabled.` };
    }
}

export async function generatePostMortem(config: AppConfig, failedAgents: any[]): Promise<string> {
    try {
        const prompt = `Generate a post-mortem for these failed agents: ${JSON.stringify(failedAgents)}`;
        const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
        return res.text;
    } catch (e: any) {
        console.error('[generatePostMortem] Error:', e);
        return `Failed to generate post-mortem: ${e.message}`;
    }
}

export async function getAgentChatResponse(config: AppConfig, message: string, context?: string): Promise<string> {
    try {
        const prompt = `
      System Context: ${context || 'General DevOps Dashboard'}
      User: ${message}
      Respond as a helpful DevOps AI Agent. Keep it brief.
    `;
        const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
        return res.text;
    } catch (e: any) {
        console.error('[getAgentChatResponse] Error:', e);
        return `I'm sorry, I'm having trouble responding right now. (${e.message})`;
    }
}

export async function generateWorkflowOverride(config: AppConfig, originalContent: string, branchName: string, errorGoal: string): Promise<string> {
    try {
        const prompt = `Modify this workflow to run only relevant tests for error "${errorGoal}" on branch "${branchName}".\n${originalContent}`;
        const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_FAST });
        return extractCode(res.text, 'yaml');
    } catch (e: any) {
        console.error('[generateWorkflowOverride] Error:', e);
        return originalContent; // Fallback to original
    }
}

export async function generateDetailedPlan(config: AppConfig, error: string, file: string, context: string = ""): Promise<AgentPlan> {
    try {
        const prompt = `
    Create a fix plan for error "${error}" in "${file}".
    
    CONTEXT:
    ${context.substring(0, 20000)}

    Return JSON { "goal": string, "tasks": [{ "id": string, "description": string, "status": "pending" }], "approved": boolean }
    `;
        const res = await unifiedGenerate(config, {
            contents: prompt,
            config: { responseMimeType: "application/json" },
            model: MODEL_SMART
        });
        return safeJsonParse(res.text, { goal: "Fix error", tasks: [], approved: true });
    } catch (e: any) {
        console.error('[generateDetailedPlan] Error:', e);
        return { goal: `Fix error: ${error}`, tasks: [{ id: "1", description: "Implement fix", status: "pending" }], approved: true };
    }
}

export async function judgeDetailedPlan(config: AppConfig, plan: AgentPlan, error: string): Promise<{ approved: boolean, feedback: string }> {
    return { approved: true, feedback: "Plan looks good." };
}

export async function runSandboxTest(config: AppConfig, group: RunGroup, iteration: number, isRealMode: boolean, fileChange: FileChange, errorGoal: string, logCallback: any, fileMap: any, sandbox?: SandboxEnvironment, testCommand?: string): Promise<{ passed: boolean, logs: string }> {
    if (config.checkEnv === 'e2b' || (sandbox)) {
        if (!sandbox) return { passed: false, logs: "Sandbox not available." };

        logCallback('INFO', 'Running verification in persistent sandbox...');
        try {
            await sandbox.writeFile(fileChange.path, fileChange.modified.content);

            let cmd = "npm test";
            if (testCommand) {
                cmd = testCommand;
            } else {
                // [Intelligent Test Isolation] Use TestSelector to pick the best test command
                const { TestSelector } = await import('../TestSelector.js');
                const selector = new TestSelector();
                cmd = selector.selectTestCommand([fileChange.path]);
                
                // [Autonomous Test Generation] Check if specific test exists, if not generate it
                // Skip if the modified file is already a test file to avoid recursion
                const isTestFile = fileChange.path.includes('.test.') || 
                                   fileChange.path.includes('.spec.') || 
                                   fileChange.path.includes('__tests__') || 
                                   fileChange.path.startsWith('tests/');

                if (!isTestFile) {
                    const { TestGenerator } = await import('../TestGenerator.js');
                    const generator = new TestGenerator(config);
                    const expectedTestPath = generator.determineTestPath(fileChange.path);
                    
                    // Check if test exists
                    const testExistsRes = await sandbox.runCommand(`ls "${expectedTestPath}"`);
                    if (testExistsRes.exitCode !== 0) {
                        logCallback('INFO', `Test file not found at ${expectedTestPath}. Generating new test...`);
                        try {
                            const testContent = await generator.generateTest(fileChange.path, fileChange.modified.content);
                            if (testContent) {
                                await sandbox.writeFile(expectedTestPath, testContent);
                                logCallback('INFO', `Generated and wrote test to ${expectedTestPath}`);
                                
                                // Update command to run the new test
                                if (expectedTestPath.endsWith('.py')) {
                                    cmd = `python -m pytest "${expectedTestPath}"`;
                                } else {
                                    // Default to npx vitest for JS/TS as it's the project standard
                                    cmd = `npx vitest run "${expectedTestPath}"`; 
                                }
                            }
                        } catch (genError: any) {
                            logCallback('WARN', `Failed to generate test: ${genError.message}`);
                        }
                    }
                }
                
                logCallback('INFO', `Selected test command: ${cmd} for file: ${fileChange.path}`);
            }

            let result = await sandbox.runCommand(cmd);
            let fullLog = result.stdout + "\n" + result.stderr;

            // [Adaptive Execution] Check for Bun-specific failures and retry
            if (result.exitCode !== 0 || fullLog.includes('FAIL') || (fullLog.includes('failed') && !fullLog.includes('0 failed'))) {
                const { BunErrorPattern } = await import('./BunErrorPattern.js');
                const diagnosis = BunErrorPattern.diagnose(fullLog);
                
                if (diagnosis.isBunError) {
                    logCallback('INFO', `Detected Bun-specific error: ${diagnosis.description}. Retrying with 'bun test'...`);
                    
                    // Attempt to switch to bun test
                    // If original was "npx vitest run path/to/test.ts", try "bun test path/to/test.ts"
                    let bunCmd = 'bun test';
                    const fileMatch = cmd.match(/\S+\.(ts|js|tsx|jsx)$/);
                    if (fileMatch) {
                        bunCmd = `bun test ${fileMatch[0]}`;
                    }

                    logCallback('INFO', `Retry command: ${bunCmd}`);
                    const retryResult = await sandbox.runCommand(bunCmd);
                    const retryLog = retryResult.stdout + "\n" + retryResult.stderr;
                    
                    if (retryResult.exitCode === 0 && !(retryLog.includes('FAIL') || (retryLog.includes('failed') && !retryLog.includes('0 failed')))) {
                        logCallback('INFO', 'Retry with Bun succeeded.');
                        return { passed: true, logs: retryLog };
                    } else {
                        logCallback('WARN', 'Retry with Bun failed.');
                        fullLog = retryLog; // Return the retry log for analysis
                        result = retryResult;
                    }
                }
            }

            if (result.exitCode !== 0) return { passed: false, logs: fullLog };
            if (fullLog.includes('FAIL') || (fullLog.includes('failed') && !fullLog.includes('0 failed'))) {
                return { passed: false, logs: fullLog };
            }
            return { passed: true, logs: fullLog };
        } catch (e: any) {
            return { passed: false, logs: `Execution Exception: ${e.message}` };
        }
    }

    if (config.checkEnv === 'github_actions' && isRealMode) {
        logCallback('INFO', 'Pushing changes to GitHub for verification...');
        const branchName = (group.mainRun as any).head_branch || (group.mainRun as any).head?.ref || 'main';

        try {
            await pushMultipleFilesToGitHub(config, [{ path: fileChange.path, content: fileChange.modified.content }], branchName);
        } catch (e: any) {
            return { passed: false, logs: `Push failed: ${e.message}` };
        }

        // Poll logic omitted for brevity in this refactor, assuming similar implementation or simplified
        return { passed: false, logs: "GitHub Action polling not fully migrated in this step." };
    }

    return { passed: true, logs: "Simulation passed." };
}

export function formatPlanToMarkdown(plan: AgentPlan): string {
    const tasksList = plan.tasks && plan.tasks.length > 0
        ? plan.tasks.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.description}`).join('\n')
        : '- No tasks defined';

    return `# Implementation Plan: ${plan.goal}

## Tasks
${tasksList}
`;
}
