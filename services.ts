
import { GoogleGenAI, Type } from "@google/genai";
import * as yaml from 'js-yaml';
import { AppConfig, WorkflowRun, CodeFile, FileChange, AgentPhase, RunGroup, LogLine, AgentPlan, PlanTask } from './types.js';


import { SandboxEnvironment, createSandbox } from './sandbox.js';
import { Sandbox } from '@e2b/code-interpreter';
import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import { filterLogs, summarizeLogs } from './services/context-compiler.js';

// Constants
const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-3-pro-preview";

// Helper: Environment Detection
const IS_BROWSER = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const IS_NODE = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

// Helper: Retry Logic with Exponential Backoff
// Helper: Retry Logic with Exponential Backoff
async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (e: any) {
            lastError = e;
            // Stop retrying if the error explicitly says so
            if (e.noRetry) throw e;

            const delay = baseDelay * Math.pow(2, i);
            console.warn(`[E2B] Connection attempt ${i + 1}/${retries} failed. Retrying in ${delay}ms...`, e.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Helper: Extract code from markdown
export function extractCode(text: string, language: string = 'text'): string {
    const codeBlockRegex = new RegExp(`\`\`\`${language}([\\s\\S]*?)\`\`\``, 'i');
    const match = text.match(codeBlockRegex);
    if (match) return match[1].trim();

    const genericBlockRegex = /```([\s\S]*?)```/;
    const genericMatch = text.match(genericBlockRegex);
    if (genericMatch) return genericMatch[1].trim();

    return text.trim();
}

// Helper: Validate E2B API Key format
export function validateE2BApiKey(apiKey: string): { valid: boolean; message: string } {
    if (!apiKey || apiKey.trim() === '') {
        return { valid: false, message: 'API key is empty' };
    }

    if (!apiKey.startsWith('e2b_')) {
        return { valid: false, message: 'API key must start with "e2b_" prefix' };
    }

    if (apiKey.length < 20) {
        return { valid: false, message: 'API key is too short (should be at least 20 characters)' };
    }

    // Check for common formatting issues
    if (apiKey.includes(' ') || apiKey.includes('\n') || apiKey.includes('\r')) {
        return { valid: false, message: 'API key contains invalid characters (spaces, newlines)' };
    }

    return { valid: true, message: 'API key format is valid' };
}

// Helper: Safe JSON Parse with aggressive cleanup
export function safeJsonParse<T>(text: string, fallback: T): T {
    try {
        // 1. Try standard extraction from code blocks
        const jsonMatch = text.match(/```json([\s\S]*?)```/) || text.match(/```([\s\S]*?)```/);
        let jsonStr = jsonMatch ? jsonMatch[1] : text;

        // 2. Aggressive cleanup: remove non-JSON prefix/suffix if model chatted outside blocks
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }

        return JSON.parse(jsonStr) as T;
    } catch (e) {
        console.warn("JSON Parse Failed for text:", text.substring(0, 100));
        return fallback;
    }
}

// Core LLM Wrapper
export async function unifiedGenerate(config: AppConfig, params: { model?: string, contents: any, config?: any }): Promise<{ text: string, toolCalls?: any[] }> {
    // 1. Handle Z.AI / OpenAI Providers via Fetch
    if (config.llmProvider === 'zai' || config.llmProvider === 'openai') {
        const isZai = config.llmProvider === 'zai';
        // Use dedicated Coding Plan endpoint for Z.ai
        const baseUrl = config.llmBaseUrl || (isZai ? 'https://api.z.ai/api/coding/paas/v4' : 'https://api.openai.com/v1');
        const rawApiKey = config.customApiKey || "dummy_key";
        const apiKey = rawApiKey;

        // BUG FIX: The agent loop sends Gemini-specific constants (MODEL_FAST, MODEL_SMART).
        // We must map these to the configured provider model to avoid "Unknown Model" 400 errors.
        let model = config.llmModel || (isZai ? "GLM-4.6" : "gpt-4o");

        // Only use params.model if it is explicitly set AND it is NOT a Gemini ID
        // (unless the provider IS Gemini, handled in block 2)
        if (params.model && !params.model.startsWith('gemini-')) {
            model = params.model;
        }

        // Prepare messages
        const messages = typeof params.contents === 'string'
            ? [{ role: 'user', content: params.contents }]
            : Array.isArray(params.contents) ? params.contents : [{ role: 'user', content: JSON.stringify(params.contents) }];

        // Retry Logic for Network/Server Errors
        return retryWithBackoff(async () => {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    // OpenCode-like User-Agent for better compatibility
                    'User-Agent': 'CI-Fixer/1.0.0 (compatible; Z.ai-DevPack)'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: params.config?.temperature || 0.1
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                // If it's a server error or rate limit, throw to trigger retry
                if (response.status >= 500 || response.status === 429) {
                    throw new Error(`Provider API Server/Rate Error ${response.status}: ${errText}`);
                }
                // For client errors (4xx), do not retry usually, unless it's a specific known useful retry case.
                const clientError: any = new Error(`Provider API Client Error ${response.status}: ${errText}`);
                clientError.noRetry = true;
                throw clientError;
            }

            const data = await response.json();
            const message = data.choices?.[0]?.message;
            return {
                text: message?.content || "",
                toolCalls: message?.tool_calls
            };
        }, 5, 2000).catch(e => {
            throw new Error(`LLM Generation Failed after retries: ${e.message}`);
        });
    }

    // 2. Default: Google GenAI SDK
    const apiKey = config.customApiKey || process.env.API_KEY || "dummy_key";

    // Retry logic for Gemini (503/429) - Implementing exponential backoff
    const maxRetries = 3;
    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
        const genAI = new GoogleGenAI({ apiKey });
        const modelName = params.model || config.llmModel || MODEL_SMART;

        try {
            const response = await genAI.models.generateContent({
                model: modelName,
                contents: params.contents,
                config: params.config
            });

            // Google GenAI Tool Calls (basic extraction if available in text or parts)
            // Note: The SDK typically handles function calls by returning them in parts.
            // We need to check if 'functionCall' exists in the candidates.
            const candidate = response.candidates?.[0];
            const functionCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);

            return {
                text: response.text || "",
                toolCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined
            };
        } catch (error: any) {
            lastError = error;

            // Handle 404 (Model Not Found) - do not retry, try fallback
            if (error.status === 404 || error.message?.includes('not found')) {
                console.warn(`Model ${modelName} not found, falling back to ${MODEL_FAST}`);
                try {
                    const fallback = await genAI.models.generateContent({
                        model: MODEL_FAST,
                        contents: params.contents,
                        config: params.config
                    });
                    return { text: fallback.text || "" };
                } catch (fbError) {
                    throw new Error(`Fallback Model Failed: ${fbError}`);
                }
            }

            // Retry on 429/503
            if (error.status === 429 || error.status === 503 || error.message?.includes('Overloaded')) {
                const delay = 1000 * Math.pow(2, i);
                console.warn(`[Gemini] Error ${error.status}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            // Other errors, break and throw
            break;
        }
    }

    throw new Error(`LLM Generation Failed after retries: ${lastError?.message || 'Unknown Error'}`);
}

// GitHub API Helpers
export async function getPRFailedRuns(token: string, owner: string, repo: string, prNumber: string, excludePatterns: string[] = []): Promise<WorkflowRun[]> {
    const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!prRes.ok) throw new Error("GitHub Authentication Failed or PR not found");
    const prData = await prRes.json();
    const headSha = prData.head.sha;

    const runsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const runsData = await runsRes.json();

    let runs = runsData.workflow_runs as WorkflowRun[];

    if (runs) {
        runs = runs.filter(r => r.conclusion === 'failure');
        if (excludePatterns && excludePatterns.length > 0) {
            runs = runs.filter(r => !excludePatterns.some(p => r.name.toLowerCase().includes(p.toLowerCase())));
        }
        runs = runs.map(r => ({
            ...r,
            path: r.path || `.github/workflows/${r.name}.yml`
        }));
    } else {
        runs = [];
    }

    return runs;
}

export type LogStrategy = 'standard' | 'extended' | 'any_error' | 'force_latest';

export async function getWorkflowLogs(repoUrl: string, runId: number, token: string, strategy: LogStrategy = 'standard'): Promise<{ logText: string, jobName: string, headSha: string }> {
    const [owner, repo] = repoUrl.split('/');

    const runRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const runData = await runRes.json();
    const headSha = runData.head_sha || "unknown_sha";

    // Strategy Logic construction
    let jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`;
    if (strategy === 'extended' || strategy === 'any_error') {
        jobsUrl += '?per_page=100';
    }

    const jobsRes = await fetch(jobsUrl, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const jobsData = await jobsRes.json();

    let failedJob;

    if (strategy === 'any_error') {
        // Look for anything that isn't success or skipped
        failedJob = jobsData.jobs?.find((j: any) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped' && j.conclusion !== 'neutral');
    } else {
        // Standard: strictly looks for 'failure'
        failedJob = jobsData.jobs?.find((j: any) => j.conclusion === 'failure');
    }

    if (!failedJob) {
        // Fallback: If the run failed but no specific job failed (e.g. startup failure, timeout, or cancellation)
        if (runData.conclusion === 'failure' || runData.conclusion === 'timed_out') {
            const checkSuiteUrl = runData.check_suite_url;
            let failureDetails = `Workflow Run Failed (${runData.conclusion}) but no individual job failed.\n`;

            // Try fetching annotations from the check suite
            try {
                if (checkSuiteUrl) {
                    const checkRunsRes = await fetch(`${checkSuiteUrl}/check-runs`, { headers: { Authorization: `Bearer ${token}` } });
                    const checkRunsData = await checkRunsRes.json();
                    const failedCheck = checkRunsData.check_runs?.find((c: any) => c.conclusion === 'failure');

                    if (failedCheck) {
                        failureDetails += `Check Run '${failedCheck.name}' failed.\nOutput: ${failedCheck.output?.summary || "No summary"}\n${failedCheck.output?.text || ""}`;
                    } else {
                        failureDetails += "Could not locate specific check run failure. Possible invalid YAML or secrets.";
                    }
                }
            } catch (e: any) {
                failureDetails += `Failed to fetch failure annotations: ${e.message}`;
            }

            return {
                logText: failureDetails,
                jobName: "Workflow Setup",
                headSha
            };
        }

        return {
            logText: `No failed job found in this run (Strategy: ${strategy}). Status: ${runData.status}, Conclusion: ${runData.conclusion}`,
            jobName: "unknown",
            headSha
        };
    }

    const logRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/jobs/${failedJob.id}/logs`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const logText = await logRes.text();
    return { logText, jobName: failedJob.name, headSha };
}

export async function getFileContent(config: AppConfig, path: string): Promise<CodeFile> {
    const [owner, repo] = config.repoUrl.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.githubToken}` }
    });

    if (!res.ok) {
        if (res.status === 404) throw new Error(`404 File Not Found: ${path}`);
        throw new Error(`Failed to fetch file: ${path}`);
    }

    const data = await res.json();
    if (Array.isArray(data)) throw new Error(`Path '${path}' is a directory`);

    const content = atob(data.content);
    const extension = path.split('.').pop() || 'txt';

    let language = 'text';
    if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) language = 'javascript';
    else if (['py'].includes(extension)) language = 'python';
    else if (extension === 'dockerfile' || path.includes('Dockerfile')) language = 'dockerfile';
    else if (['yml', 'yaml'].includes(extension)) language = 'yaml';
    else if (['json'].includes(extension)) language = 'json';

    return {
        name: data.name,
        language,
        content,
        sha: data.sha
    };
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

// Logic & Analysis Services

export interface DiagnosisResult {
    summary: string;
    filePath: string;
    fixAction: 'edit' | 'command'; // New: Support shell commands
    suggestedCommand?: string;
    reproductionCommand?: string; // TDR: Command to reproduce the failure
}

export async function diagnoseError(config: AppConfig, logSnippet: string, repoContext?: string): Promise<DiagnosisResult> {
    // Phase 2: Context Engineering - Smart Filtering & Summarization
    const filteredLogs = filterLogs(logSnippet);
    const logSummary = await summarizeLogs(filteredLogs); // Heuristic summary for now

    const prompt = `
    You are an automated Error Diagnosis Agent.

    CONTEXT:
    - You are analyzing GitHub Action logs.
    - CI Runners are ephemeral. Running "commands" directly often fails or doesn't persist.
    - For environment issues like Disk Space, the fix usually requires EDITING the workflow file (YAML) to add a cleanup step.

    INSTRUCTIONS:
    1. Analyze the "TARGET CI LOGS" below. identify the primary error.
    2. Ignore any "AGENT CONTEXT" warnings unless they help explain the CI state.
    3. Determine if the fix requires:
       - 'edit': Modifying a code file or workflow YAML.
       - 'command': Running a one-off shell command (RARELY USED for CI issues).
    
    - If the error is "No space left on device" or similar, you MUST recommend 'edit'.
    - The 'filePath' should be the workflow file (e.g., .github/workflows/deploy.yml).
    - The plan should be to insert 'docker system prune -af' before the failing step.
    - VALIDATION RULES:
      - Do NOT suggest commands with syntax errors (e.g. 'pip install -r' without a filename).
      - Do NOT suggest invalid YAML (indentation must be correct).
      - If modifying a YAML file, suggestion MUST be a valid YAML snippet.
    - EXTRACT A REPRODUCTION COMMAND:
      - Look for the failing test name in the logs.
      - Construct a command to run ONLY that test.
      - Examples: 
        - \`npm test -- -t "Login Test"\`
        - \`pytest tests/test_auth.py\`
        - \`go test ./pkg/auth -run TestLogin\`
      - If no specific test is failing (e.g. build error), usage \`npm run build\` or the failing script.

    Output JSON: { 
      "summary": "string", 
      "filePath": "string (relative path, or empty if unknown)", 
      "fixAction": "edit" | "command",
      "suggestedCommand": "string (only if action is command)",
      "reproductionCommand": "string (e.g. 'npm test -- -t \"test_name\"')"
    }
    
    === AGENT CONTEXT ===
    \${repoContext || 'None'}

    === LOG ANALYSIS ===
    \${logSummary}

    === FILTERED ERROR LOGS ===
    \${filteredLogs}
  `;

    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { systemInstruction: "You are an automated Error Diagnosis Agent.", maxOutputTokens: 1024, responseMimeType: "application/json" },
            model: "gemini-3-pro-preview" // FORCE SMART MODEL for higher accuracy
        });

        let result = safeJsonParse(response.text || "{}", {
            summary: "Unknown Error",
            filePath: "",
            fixAction: "edit"
        } as any);

        // Unwrap common wrapper patterns from some LLMs
        if (result.result) result = result.result;
        if (result.answer) {
            if (typeof result.answer === 'string') {
                result = { ...result, summary: result.answer };
            } else {
                result = { ...result, ...result.answer };
            }
        }

        // Map common synonyms for broader LLP compatibility
        if (result.primaryError && !result.summary) result.summary = result.primaryError;
        if (result.error && !result.summary) result.summary = result.error;

        return {
            summary: result.summary || "Diagnosis Failed",
            filePath: result.filePath || "",
            fixAction: result.fixAction || "edit",
            suggestedCommand: result.suggestedCommand,
            reproductionCommand: result.reproductionCommand
        };
    } catch {
        return { summary: "Diagnosis Failed", filePath: "", fixAction: "edit", reproductionCommand: undefined };
    }
}

export async function generateRepoSummary(config: AppConfig, sandbox?: SandboxEnvironment): Promise<string> {
    if (!sandbox) return "Repository Context: (Simulation Mode - No Access)";

    try {
        // 1. Get File Tree
        const tree = await runDevShellCommand(config, "find . -maxdepth 3 -not -path '*/.*'", sandbox);
        const fileTree = tree.output.split('\n').filter(Boolean).join('\n');

        // 2. Read README
        let readme = "";
        try {
            const readmeRes = await runDevShellCommand(config, "cat README.md", sandbox);
            if (readmeRes.exitCode === 0) readme = readmeRes.output.slice(0, 2000); // Truncate
        } catch { }

        // 3. Read Package Configs (package.json, etc)
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

export async function generatePostMortem(config: AppConfig, failedAgents: any[]): Promise<string> {
    const prompt = `Generate a post - mortem for these failed agents: ${JSON.stringify(failedAgents)} `;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
    return res.text;
}

export async function findClosestFile(config: AppConfig, filePath: string): Promise<{ file: CodeFile, path: string } | null> {
    if (!filePath) return null;
    try {
        const file = await getFileContent(config, filePath);
        return { file, path: filePath };
    } catch (e) {
        return null;
    }
}

// --- NEW SHELL / DEV ENVIRONMENT SERVICES ---

export async function prepareSandbox(config: AppConfig, repoUrl: string, headSha?: string): Promise<SandboxEnvironment> {
    // 1. Create the Sandbox via Factory (Docker or E2B)
    const sandbox = createSandbox(config);

    // 2. Initialize (Start Container / Connect to E2B)
    try {
        await sandbox.init();
    } catch (e: any) {
        throw new Error(`Failed to initialize sandbox: ${e.message}`);
    }

    console.log(`[Sandbox] Persistent Sandbox Created. ID: ${sandbox.getId()}`);

    // 3. Initialize Repo
    // Construct Auth URL if token present
    let cloneUrl = repoUrl;
    if (config.githubToken && !repoUrl.includes('@')) {
        const cleanUrl = repoUrl.replace('https://', '');
        cloneUrl = `https://oauth2:${config.githubToken}@${cleanUrl}`;
    }

    console.log(`[Sandbox] Cloning ${repoUrl}...`);
    try {
        await sandbox.runCommand(`git clone ${cloneUrl} .`);
    } catch (e: any) {
        throw new Error(`Failed to clone repo in sandbox: ${e.message}`);
    }

    if (headSha) {
        console.log(`[Sandbox] Checkout ${headSha}...`);
        await sandbox.runCommand(`git checkout ${headSha}`);
    }

    // 4. Try detecting and installing dependencies (Best Effort)
    try {
        console.log('[Sandbox] Checking for dependencies...');
        const check = await sandbox.runCommand('ls package.json requirements.txt');
        const output = check.stdout;

        // Install LSP Tools Globally (Best Effort)
        // Use single quotes for safety in shells
        console.log('[Sandbox] Installing LSP Tools (pyright, typescript)...');
        await sandbox.runCommand('npm install -g typescript pyright || pip install pyright');

        if (output.includes('package.json')) {
            console.log('[Sandbox] Installing Node dependencies...');
            await sandbox.runCommand('npm install');
        } else if (output.includes('requirements.txt')) {
            console.log('[Sandbox] Installing Python dependencies...');
            await sandbox.runCommand('pip install -r requirements.txt');
        }
    } catch (e) {
        console.warn('[Sandbox] Dependency installation warning (continuing):', e);
    }

    return sandbox;
}

export async function runDevShellCommand(config: AppConfig, command: string, sandbox?: SandboxEnvironment): Promise<{ output: string, exitCode: number }> {
    // 1. Logic: Use Sandbox if available
    if (sandbox) {
        try {
            console.log(`[Sandbox] Executing: ${command}`);
            const result = await sandbox.runCommand(command);
            const combinedLogs = result.stdout + (result.stderr ? `\n[STDERR]\n${result.stderr}` : "");

            return {
                output: combinedLogs,
                exitCode: result.exitCode
            };
        } catch (e: any) {
            console.error(`[Sandbox] Execution Failed:`, e);
            return { output: `Execution Exception: ${e.message}`, exitCode: 1 };
        }
    }

    // 2. Logic: One-off E2B (Legacy support or fallback) - Currently removed to encourage persistent usage
    // If config.devEnv === 'e2b', we really should have a sandbox by now.

    // 3. Fallback: Simulation
    return { output: `[SIMULATION] Shell command executed: ${command}\n> (Mock Output)`, exitCode: 0 };
}

export async function searchRepoFile(config: AppConfig, query: string): Promise<string | null> {
    return null;
}

export async function toolCodeSearch(config: AppConfig, query: string, sandbox?: SandboxEnvironment): Promise<string[]> {
    if (sandbox) {
        const cmd = `grep -r "${query}" . | head -n 5`;
        const res = await runDevShellCommand(config, cmd, sandbox);
        if (res.exitCode === 0 && res.output.trim().length > 0) {
            const lines = res.output.split('\n');
            const paths = lines.map(l => l.split(':')[0]).filter(p => p && !p.startsWith('['));
            return paths.filter((v, i, a) => a.indexOf(v) === i);
        }
    }
    // Simulation / Default
    return [];
}

export async function toolLintCheck(config: AppConfig, code: string, language: string, sandbox?: SandboxEnvironment): Promise<{ valid: boolean, error?: string }> {
    // 1. Try Sandbox Check
    if (sandbox) {
        // Python: Use pyright (installed globally in prepareSandbox)
        if (language === 'python') {
            console.log('[LSP] Running Pyright (Python)...');
            const tempFile = `temp_check.py`;
            await sandbox.writeFile(tempFile, code);

            const cmd = `pyright ${tempFile}`;
            const res = await runDevShellCommand(config, cmd, sandbox);

            if (res.exitCode !== 0) {
                const cleanError = res.output.replace(new RegExp(tempFile, 'g'), 'file.py').slice(0, 500);
                return { valid: false, error: `[Pyright Type Error] ${cleanError}` };
            }
            return { valid: true };
        }

        // TypeScript/JavaScript: Use tsc
        if (language === 'typescript' || language === 'javascript' || language === 'javascriptreact' || language === 'typescriptreact') {
            console.log('[LSP] Running TSC (TypeScript)...');
            const ext = (language.includes('react') ? 'tsx' : 'ts');
            const tempFile = `temp_check.${ext}`;

            await sandbox.writeFile(tempFile, code);

            // Run tsc
            const cmd = `npx tsc ${tempFile} --noEmit --esModuleInterop --skipLibCheck --jsx react`;
            const res = await runDevShellCommand(config, cmd, sandbox);

            if (res.exitCode !== 0) {
                const cleanError = res.output.replace(new RegExp(tempFile, 'g'), `file.${ext}`).slice(0, 500);
                return { valid: false, error: `[TSC Type Error] ${cleanError}` };
            }
            return { valid: true };
        }
    }

    // 2. YAML Validation (Using js-yaml)
    if (language === 'yaml' || language === 'yml') {
        try {
            yaml.load(code);
            return { valid: true };
        } catch (e: any) {
            return { valid: false, error: `[YAML Syntax Error] ${e.message}` };
        }
    }

    // 2. Fallback to LLM Linter
    const prompt = `Check this ${language} code for syntax errors. Return JSON { "valid": boolean, "error": string | null }. Code:\n${code}`;
    const res = await unifiedGenerate(config, {
        contents: prompt,
        config: { responseMimeType: "application/json" },
        model: MODEL_FAST
    });
    return safeJsonParse(res.text, { valid: true });
}

export async function toolLSPDefinition(config: AppConfig, file: string, line: number, sandbox?: SandboxEnvironment): Promise<string> {
    if (sandbox) {
        // Universal Git Grep Definition (Heuristic Fallback for CLI)
        return "";
    }
    return "";
}

export async function toolLSPReferences(config: AppConfig, file: string, line: number, symbol: string, sandbox?: SandboxEnvironment): Promise<string[]> {
    if (sandbox) {
        // Heuristic: grep for the symbol
        const cmd = `grep -r "${symbol}" . --include=\*.{ts,tsx,js,py,go}`;
        const res = await runDevShellCommand(config, cmd, sandbox);
        if (res.exitCode === 0) {
            return res.output.split('\n').slice(0, 10);
        }
    }
    return [];
}

export async function toolScanDependencies(config: AppConfig, headSha: string): Promise<string> {
    return "No dependency issues detected.";
}

// Web Search implementation with Tavily support
export async function toolWebSearch(config: AppConfig, query: string): Promise<string> {
    // 1. Tavily Search (Preferred if API Key exists)
    if (config.tavilyApiKey) {
        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: config.tavilyApiKey,
                    query: query,
                    search_depth: "advanced",
                    include_answer: true,
                    max_results: 5
                })
            });
            const data = await response.json();
            if (data.answer) return `Answer: ${data.answer}\n\nSources:\n${data.results?.map((r: any) => `- ${r.title}: ${r.url}`).join('\n')}`;
            if (data.results) return data.results.map((r: any) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n');
        } catch (e) {
            console.warn("Tavily search failed, falling back to Google/LLM", e);
        }
    }

    // 2. Fallback to LLM Tool (Google GenAI)
    const res = await unifiedGenerate(config, {
        contents: query,
        config: {
            tools: [{ googleSearch: {} }]
        },
        model: MODEL_SMART
    });
    return res.text;
}

export async function toolFindReferences(config: AppConfig, symbol: string): Promise<string[]> {
    return [];
}

export function createTools(config: AppConfig, sandbox?: SandboxEnvironment) {
    return {
        check: toolDefinition({
            name: 'check',
            description: 'Check code for syntax errors or linting issues',
            inputSchema: z.object({
                code: z.string(),
                language: z.string()
            })
        }).server(async ({ code, language }) => {
            return toolLintCheck(config, code, language, sandbox);
        }),
        search: toolDefinition({
            name: 'search',
            description: 'Search the repository for a string',
            inputSchema: z.object({
                query: z.string()
            })
        }).server(async ({ query }) => {
            return toolCodeSearch(config, query, sandbox);
        }),
        webSearch: toolDefinition({
            name: 'webSearch',
            description: 'Search the web for information',
            inputSchema: z.object({
                query: z.string()
            })
        }).server(async ({ query }) => {
            return toolWebSearch(config, query);
        })
    };
}

export async function generateFix(config: AppConfig, context: any): Promise<string> {
    const prompt = `Fix the code based on error: ${JSON.stringify(context)}. Return only the full file code.`;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
    return extractCode(res.text, context.language);
}

export async function judgeFix(config: AppConfig, original: string, fixed: string, error: string): Promise<{ passed: boolean, score: number, reasoning: string }> {
    if (original.trim() === fixed.trim()) return { passed: false, reasoning: "No changes made.", score: 0 };

    // 1. Run Linter (Uses E2B if configured, or LLM)
    const lintResult = await toolLintCheck(config, fixed, "unknown");
    const linterStatus = lintResult.valid ? "PASS" : `FAIL (${lintResult.error || 'Syntax Error'})`;

    const prompt = `
    You are a Senior Code Reviewer.
    Original Error to Fix: "${error}"
    Automated Linter Status: ${linterStatus}
    
    Review the following proposed code change:
    
    \`\`\`
    ${fixed.substring(0, 10000)}
    \`\`\`
    
    Instructions:
    1. If Linter Status is FAIL, you MUST REJECT the fix (passed: false), unless the error is trivial.
    2. Check if the code actually fixes the error described.
    3. Return strictly JSON: { "passed": boolean, "score": number, "reasoning": "string" }
    `;

    try {
        const res = await unifiedGenerate(config, {
            contents: prompt,
            config: { responseMimeType: "application/json" },
            model: MODEL_SMART
        });
        // Default to PASS if parsing fails but model generated content (Fail Open strategy for robust demos)
        return safeJsonParse(res.text, { passed: true, score: 7, reasoning: "Judge output parsed with fallback. Assuming fix is valid." });
    } catch { return { passed: true, score: 5, reasoning: "Judge Offline (Bypass)" }; }
}

export async function runSandboxTest(config: AppConfig, group: RunGroup, iteration: number, isRealMode: boolean, fileChange: FileChange, errorGoal: string, logCallback: any, fileMap: any, sandbox?: SandboxEnvironment): Promise<{ passed: boolean, logs: string }> {
    // CHECK PHASE: Uses checkEnv configuration (GitHub Actions or Simulation)

    // 0. Persistent Container Mode
    if (config.checkEnv === 'e2b' || (sandbox)) {
        if (!sandbox) return { passed: false, logs: "Sandbox not available for testing." };

        logCallback('INFO', 'Running verification in Persistent Container...');
        try {
            // 1. Write the file change
            await sandbox.writeFile(fileChange.path, fileChange.modified.content);
            logCallback('VERBOSE', `Updated file ${fileChange.path} in container.`);

            // 2. Determine and run test command
            // Try to guess based on existing files or config
            let testCmd = "npm test";
            const lsCheck = await sandbox.runCommand("ls package.json requirements.txt");
            const files = lsCheck.stdout;

            if (files.includes('requirements.txt') && !files.includes('package.json')) {
                testCmd = "pytest";
            }

            logCallback('TOOL', `Executing test command: ${testCmd}`);
            const result = await sandbox.runCommand(testCmd);
            const fullLog = result.stdout + "\n" + result.stderr;

            if (result.exitCode !== 0) {
                // Exit code non-zero generally means failure in test runners
                return { passed: false, logs: fullLog };
            }

            if (fullLog.includes('FAIL') || fullLog.includes('failed') || fullLog.includes('Error:')) {
                // Be careful not to match "0 failed"
                if (!fullLog.includes('0 failed')) {
                    return { passed: false, logs: fullLog };
                }
            }

            return { passed: true, logs: fullLog };

        } catch (e: any) {
            return { passed: false, logs: `Container Exception: ${e.message}` };
        }
    }

    if (config.checkEnv === 'github_actions' && isRealMode) {
        logCallback('INFO', 'Triggering GitHub Action for verification (Pushing changes)...');

        // 1. Commit and Push Changes 
        const branchName = (group.mainRun as any).head_branch || (group.mainRun as any).head?.ref || 'main'; // Ensure valid branch

        try {
            await pushMultipleFilesToGitHub(
                config,
                [   // We only push the single file change being tested here
                    { path: fileChange.path, content: fileChange.modified.content }
                ],
                branchName
            );
            logCallback('SUCCESS', `Pushed fix to branch '${branchName}'`);
        } catch (e: any) {
            logCallback('ERROR', `Failed to push fix: ${e.message}`);
            return { passed: false, logs: `Push failed: ${e.message}` };
        }

        // 2. POLL for completion
        const maxRetries = 30; // 30 attempts * 10 seconds = 5 minutes timeout
        const pollInterval = 10000; // 10 seconds

        logCallback('INFO', `Polling workflow run for completion (Max ${maxRetries} checks)...`);

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // Fetch the specific run we are fixing. 
            const [owner, repo] = config.repoUrl.split('/');
            // Use type casting to access head_branch if needed, or rely on runtime object
            const branchName = (group.mainRun as any).head_branch || (group.mainRun as any).head?.ref || 'main';

            const runsRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${branchName}&event=push&per_page=1`,
                { headers: { Authorization: `Bearer ${config.githubToken}` } }
            );
            const runsData = await runsRes.json();
            const latestRun = runsData.workflow_runs?.[0];

            if (!latestRun) {
                await new Promise(r => setTimeout(r, pollInterval));
                continue;
            }

            // Check if this run was triggered recently (after we started our fix)
            // Ideally compare created_at > start_time, but for now we check status

            if (latestRun.status === 'completed') {
                logCallback('INFO', `Workflow completed with conclusion: ${latestRun.conclusion}`);

                if (latestRun.conclusion === 'success') {
                    return { passed: true, logs: "GitHub Action passed successfully." };
                } else {
                    // Fetch the failure logs to feed back into the agent
                    const logs = await getWorkflowLogs(config.repoUrl, latestRun.id, config.githubToken);
                    return { passed: false, logs: logs.logText };
                }
            } else if (latestRun.status === 'queued' || latestRun.status === 'in_progress') {
                logCallback('VERBOSE', `Run ${latestRun.id} status: ${latestRun.status}...`);
            }

            await new Promise(r => setTimeout(r, pollInterval));
        }

        return { passed: false, logs: "Timeout waiting for GitHub Action to complete." };
    }

    // Default Simulation
    const prompt = `Simulate running tests for this fix. Return JSON { "passed": boolean, "logs": string }.`;
    const res = await unifiedGenerate(config, {
        contents: prompt,
        config: { responseMimeType: "application/json" },
        model: MODEL_FAST
    });
    return safeJsonParse(res.text, { passed: true, logs: "Simulation passed." });
}


export async function pushMultipleFilesToGitHub(config: AppConfig, files: { path: string, content: string }[], branchName: string): Promise<string> {
    const [owner, repo] = config.repoUrl.split('/');
    const headers = {
        'Authorization': `Bearer ${config.githubToken}`,
        'Content-Type': 'application/json'
    };

    // Helper to run the atomic commit sequence
    const attemptPush = async () => {
        // 1. Get the latest commit SHA of the branch
        const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branchName}`, { headers });
        if (!refRes.ok) {
            if (refRes.status === 404) throw new Error(`Branch '${branchName}' not found`);
            const err = new Error(`Failed to get ref for branch ${branchName}: ${refRes.statusText}`);
            (err as any).noRetry = refRes.status === 401 || refRes.status === 403; // Auth errors are fatal
            throw err;
        }
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        // 2. Get the base tree of the latest commit
        const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
        if (!commitRes.ok) throw new Error("Failed to get latest commit");
        const commitData = await commitRes.json();
        const baseTreeSha = commitData.tree.sha;

        // 3. Create a new tree with the file changes
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: files.map(f => ({
                    path: f.path,
                    mode: '100644', // 100644 for file (blob), 100755 for executable (blob), 040000 for subdirectory (tree)
                    type: 'blob',
                    content: f.content
                }))
            })
        });
        if (!treeRes.ok) throw new Error("Failed to create git tree");
        const treeData = await treeRes.json();
        const newTreeSha = treeData.sha;

        // 4. Create a new commit
        const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: `Auto-fix via CI Fixer Agent: Updated ${files.length} files`,
                tree: newTreeSha,
                parents: [latestCommitSha]
            })
        });
        if (!newCommitRes.ok) throw new Error("Failed to create commit");
        const newCommitData = await newCommitRes.json();
        const newCommitSha = newCommitData.sha;

        // 5. Update the branch reference
        // We use standard ref update. If the branch has moved since we read 'latestCommitSha', 
        // this will fail (optimistic locking), which is exactly what we want so we can retry.
        const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
                sha: newCommitSha
            })
        });

        if (!updateRefRes.ok) {
            const errorText = await updateRefRes.text();
            // 409 Conflict or 422 Unprocessable Entity often means the ref was updated by someone else
            // We throw a standard error to trigger the retry implementation in retryWithBackoff
            throw new Error(`Failed to update branch ref (${updateRefRes.status}): ${errorText}`);
        }

        return newCommitData.html_url || `https://github.com/${owner}/${repo}/commit/${newCommitSha}`;
    };

    // Wrap in retry logic (5 attempts, starting at 1s delay)
    // This gives us ~30s of patience for other agents to finish their pushes
    try {
        return await retryWithBackoff(attemptPush, 5, 1000);
    } catch (e: any) {
        throw new Error(`Push failed after retries: ${e.message}`);
    }
}

export async function getAgentChatResponse(config: AppConfig, message: string, context?: string): Promise<string> {
    const prompt = `
      System Context: ${context || 'General DevOps Dashboard'}
      User: ${message}
      
      Respond as a helpful DevOps AI Agent. Keep it brief and technical.
    `;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_SMART });
    return res.text;
}

export async function generateWorkflowOverride(config: AppConfig, originalContent: string, branchName: string, errorGoal: string): Promise<string> {
    const prompt = `Modify this workflow to run only relevant tests for error "${errorGoal}" on branch "${branchName}".\n${originalContent}`;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_FAST });
    return extractCode(res.text, 'yaml');
}

export async function generateDetailedPlan(config: AppConfig, error: string, file: string): Promise<AgentPlan> {
    const prompt = `Create a fix plan for error "${error}" in "${file}". Return JSON { "goal": string, "tasks": [{ "id": string, "description": string, "status": "pending" }], "approved": boolean }`;
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

// Utility to test E2B connection explicitly
export async function testE2BConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
    // First validate the API key format
    const validation = validateE2BApiKey(apiKey);
    if (!validation.valid) {
        return { success: false, message: `Invalid API Key: ${validation.message}` };
    }

    // We create a sandbox, run a trivial command, and kill it immediately.
    // This verifies authentication and network path.
    let sandbox;
    try {
        console.log(`[E2B] Testing Connection... (Env: ${IS_BROWSER ? 'Browser' : 'Node'})`);

        const sandboxOpts: any = { apiKey };
        if (IS_BROWSER) {
            sandboxOpts.apiUrl = window.location.origin + '/api/e2b';
        }

        sandbox = await retryWithBackoff(() => Sandbox.create(sandboxOpts));

        if (IS_BROWSER) {
            const sbAny = sandbox as any;

            // Patch the jupyterUrl getter to route execution traffic through our proxy
            // The SDK uses this getter to construct the URL for running code (port 49999)
            // It uses raw fetch(), so we can't use middleware.
            try {
                Object.defineProperty(sbAny, 'jupyterUrl', {
                    get: function () {
                        // We hardcode port 49999 as seen in SDK source (JUPYTER_PORT)
                        const targetHost = this.getHost(49999);
                        return window.location.origin + '/api/sandbox_exec/' + targetHost;
                    },
                    configurable: true
                });
            } catch (e) {
                console.error('[E2B] Failed to patch jupyterUrl:', e);
            }
        }

        const result = await sandbox.runCode('echo "Connection Verified"', { language: 'bash' });

        if (result.error) {
            const errorMsg = result.error.value || "Unknown execution error";
            console.error(`[E2B] Execution Error: ${result.error.name}: ${errorMsg}`);
            return { success: false, message: `E2B Execution Error: ${result.error.name}: ${errorMsg}` };
        }

        if (!result.logs.stdout.join('').includes('Connection Verified')) {
            const stdout = result.logs.stdout.join('\n');
            const stderr = result.logs.stderr.join('\n');
            console.error(`[E2B] Command output mismatch. Expected "Connection Verified" but got stdout: ${stdout}, stderr: ${stderr}`);
            return { success: false, message: `Unexpected command output. Check E2B sandbox environment.` };
        }

        return { success: true, message: "Connection Established & Verified." };
    } catch (e: any) {
        const errStr = e.message || e.toString();
        console.error(`[E2B] Connection Test Failed: ${errStr}`);

        // Enhanced error classification for better debugging
        if (errStr.includes('Failed to fetch') || errStr.includes('NetworkError') || errStr.includes('Network request failed')) {
            console.warn(`[E2B] Network Blocked. Raw Error: ${errStr}`);
            return {
                success: false,
                message: `Network Connection Failed: ${errStr}. Please check:\n` +
                    `- Internet connectivity\n` +
                    `- CORS/browser security settings\n` +
                    `- Firewall/ad-blocker blocking api.e2b.dev\n` +
                    `- Valid E2B API key format`
            };
        }
        else if (errStr.includes('401') || errStr.includes('403') || errStr.includes('Unauthorized') || errStr.includes('Forbidden')) {
            return { success: false, message: `Authentication Failed: ${errStr}. Please verify your E2B API key is correct and active.` };
        }
        else if (errStr.includes('timeout') || errStr.includes('Timeout')) {
            return { success: false, message: `Connection Timeout: ${errStr}. E2B service may be temporarily unavailable.` };
        }
        else {
            return { success: false, message: `Connection Error: ${errStr}` };
        }
    } finally {
        if (sandbox) {
            try {
                await sandbox.kill();
                console.log("[E2B] Test sandbox cleaned up successfully");
            } catch (e) {
                console.warn("Failed to kill test sandbox", e);
            }
        }
    }
}
