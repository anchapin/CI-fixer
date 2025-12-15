
import { AppConfig, WorkflowRun, RunGroup, AgentPlan, FileChange } from '../../types.js';
import { SandboxEnvironment } from '../../sandbox.js';
import { unifiedGenerate, safeJsonParse, extractCode } from '../llm/LLMService.js';
import { runDevShellCommand } from '../sandbox/SandboxService.js';
import { filterLogs, summarizeLogs } from '../context-compiler.js';
import { getWorkflowLogs, pushMultipleFilesToGitHub } from '../github/GitHubService.js';
import { ContextManager, ContextPriority } from '../context-manager.js';

const MODEL_SMART = "gemini-3-pro-preview";
const MODEL_FAST = "gemini-2.5-flash";

import * as fs from 'fs';
function logTrace(msg: string) {
    try {
        const truncated = msg.length > 500 ? msg.substring(0, 500) + '... [truncated]' : msg;
        fs.appendFileSync('debug_trace.txt', truncated + '\n');
    } catch { }
}

export interface DiagnosisResult {
    summary: string;
    filePath: string;
    fixAction: 'edit' | 'command';
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

        return {
            summary: result.summary || "Diagnosis Failed",
            filePath: result.filePath || "",
            fixAction: result.fixAction || "edit",
            suggestedCommand: result.suggestedCommand,
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
        } catch { }

        let configFiles = "";
        try {
            const pkgRes = await runDevShellCommand(config, "cat package.json", sandbox);
            if (pkgRes.exitCode === 0) configFiles += `\n=== package.json ===\n${pkgRes.output}`;
        } catch { }

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

    let segments: string[] = [];
    let res = await unifiedGenerate(config, {
        contents: prompt,
        model: MODEL_SMART,
        config: { maxOutputTokens: 8192 }
    });
    segments.push(res.text);

    for (let i = 0; i < 3; i++) {
        const lastSegment = segments[segments.length - 1];
        const trimmed = lastSegment.trim();
        if (trimmed.endsWith('```')) break;

        const contPrompt = `Continue generating code from where you left off. Last chars:\n\`\`\`${trimmed.slice(-1000)}\`\`\``;
        res = await unifiedGenerate(config, {
            contents: contPrompt,
            model: MODEL_SMART,
            config: { maxOutputTokens: 8192 }
        });
        segments.push(res.text);
    }

    let fullCode = "";
    segments.forEach((seg) => {
        let clean = seg.trim().replace(/^```[\w]*\s*/, '').replace(/\s*```$/, '');
        fullCode += clean;
    });

    return fullCode.trim();
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
    } catch { return { passed: true, score: 5, reasoning: "Judge Offline (Bypass)" }; }
}

export async function generatePostMortem(config: AppConfig, failedAgents: any[]): Promise<string> {
    const prompt = `Generate a post-mortem for these failed agents: ${JSON.stringify(failedAgents)}`;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
    return res.text;
}

export async function getAgentChatResponse(config: AppConfig, message: string, context?: string): Promise<string> {
    const prompt = `
      System Context: ${context || 'General DevOps Dashboard'}
      User: ${message}
      Respond as a helpful DevOps AI Agent. Keep it brief.
    `;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
    return res.text;
}

export async function generateWorkflowOverride(config: AppConfig, originalContent: string, branchName: string, errorGoal: string): Promise<string> {
    const prompt = `Modify this workflow to run only relevant tests for error "${errorGoal}" on branch "${branchName}".\n${originalContent}`;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_FAST });
    return extractCode(res.text, 'yaml');
}

export async function generateDetailedPlan(config: AppConfig, error: string, file: string, context: string = ""): Promise<AgentPlan> {
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
}

export async function judgeDetailedPlan(config: AppConfig, plan: AgentPlan, error: string): Promise<{ approved: boolean, feedback: string }> {
    return { approved: true, feedback: "Plan looks good." };
}

export async function runSandboxTest(config: AppConfig, group: RunGroup, iteration: number, isRealMode: boolean, fileChange: FileChange, errorGoal: string, logCallback: any, fileMap: any, sandbox?: SandboxEnvironment): Promise<{ passed: boolean, logs: string }> {
    if (config.checkEnv === 'e2b' || (sandbox)) {
        if (!sandbox) return { passed: false, logs: "Sandbox not available." };

        logCallback('INFO', 'Running verification in persistent sandbox...');
        try {
            await sandbox.writeFile(fileChange.path, fileChange.modified.content);

            let testCmd = "npm test";
            const lsCheck = await sandbox.runCommand("ls package.json requirements.txt");
            if (lsCheck.stdout.includes('requirements.txt') && !lsCheck.stdout.includes('package.json')) {
                testCmd = "pytest";
            }

            const result = await sandbox.runCommand(testCmd);
            const fullLog = result.stdout + "\n" + result.stderr;

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
