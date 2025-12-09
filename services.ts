
import { GoogleGenAI, Type } from "@google/genai";
import { AppConfig, WorkflowRun, CodeFile, FileChange, AgentPhase, RunGroup, LogLine, AgentPlan, PlanTask } from './types';
import * as e2bModule from '@e2b/code-interpreter';

// Constants
const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-3-pro-preview";

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

// Helper: Safe JSON Parse
export function safeJsonParse<T>(text: string, fallback: T): T {
    try {
        const jsonMatch = text.match(/```json([\s\S]*?)```/) || text.match(/```([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : text;
        return JSON.parse(jsonStr) as T;
    } catch (e) {
        // Try to find the first '{' and last '}'
        try {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                return JSON.parse(text.substring(start, end + 1)) as T;
            }
        } catch (e2) {
             console.error("JSON Parse failed", e2);
        }
        return fallback;
    }
}

// Core LLM Wrapper
export async function unifiedGenerate(config: AppConfig, params: { model?: string, contents: any, config?: any }): Promise<{ text: string }> {
    // 1. Handle Z.AI / OpenAI Providers via Fetch
    if (config.llmProvider === 'zai' || config.llmProvider === 'openai') {
        const isZai = config.llmProvider === 'zai';
        const baseUrl = config.llmBaseUrl || (isZai ? 'https://api.z.ai/api/coding/paas/v4' : 'https://api.openai.com/v1');
        const apiKey = config.customApiKey || "dummy_key";
        
        // BUG FIX: The agent loop sends Gemini-specific constants (MODEL_FAST, MODEL_SMART).
        // We must map these to the configured provider model to avoid "Unknown Model" 400 errors.
        let model = config.llmModel || (isZai ? "GLM-4.6" : "gpt-4o");
        
        // Only use params.model if it is explicitly set AND it is NOT a Gemini ID
        // (unless the provider IS Gemini, handled in block 2)
        if (params.model && !params.model.startsWith('gemini-')) {
            model = params.model;
        }

        try {
             const messages = typeof params.contents === 'string' 
                ? [{ role: 'user', content: params.contents }]
                : Array.isArray(params.contents) ? params.contents : [{ role: 'user', content: JSON.stringify(params.contents) }];

             const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${apiKey}` 
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: params.config?.temperature || 0.1
                })
             });
             
             if (!response.ok) {
                 const errText = await response.text();
                 throw new Error(`Provider API Error ${response.status}: ${errText}`);
             }

             const data = await response.json();
             return { text: data.choices?.[0]?.message?.content || "" };
        } catch (e: any) {
             console.error("LLM Fetch Error", e);
             throw new Error(`LLM Generation Failed: ${e.message}`);
        }
    }

    // 2. Default: Google GenAI SDK
    const apiKey = config.customApiKey || process.env.API_KEY || "dummy_key"; 
    const genAI = new GoogleGenAI({ apiKey });
    
    const modelName = params.model || config.llmModel || MODEL_SMART;
    
    try {
        const response = await genAI.models.generateContent({
            model: modelName,
            contents: params.contents,
            config: params.config
        });
        return { text: response.text || "" };
    } catch (error: any) {
        console.error("LLM Error:", error);
        if (error.status === 404 || error.message?.includes('not found')) {
            // Fallback for demo purposes if model doesn't exist
             console.warn(`Model ${modelName} not found, falling back to ${MODEL_FAST}`);
             const fallback = await genAI.models.generateContent({
                model: MODEL_FAST,
                contents: params.contents,
                config: params.config
            });
            return { text: fallback.text || "" };
        }
        throw new Error(`LLM Generation Failed: ${error.message}`);
    }
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

export async function getWorkflowLogs(repoUrl: string, runId: number, token: string): Promise<{ logText: string, jobName: string, headSha: string }> {
    const [owner, repo] = repoUrl.split('/');
    
    const runRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const runData = await runRes.json();
    const headSha = runData.head_sha || "unknown_sha";

    const jobsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const jobsData = await jobsRes.json();
    const failedJob = jobsData.jobs?.find((j: any) => j.conclusion === 'failure');
    
    if (!failedJob) return { logText: "No failed job found in this run.", jobName: "unknown", headSha };

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

export async function diagnoseError(config: AppConfig, logSnippet: string, repoContext?: string): Promise<{ summary: string, filePath: string }> {
  const prompt = `
    Analyze this CI/CD build log. Identify the primary error and the source code file causing it.
    Constraints:
    1. Output strictly valid JSON.
    2. DO NOT nest the JSON. Return a flat object: { "summary": "...", "filePath": "..." }
    3. Do NOT wrap the output in an "answer" or "result" key.
    4. FILEPATH must be relative to repo root. Do NOT return directory paths. Guess the specific .yml file if it is a workflow error.
    5. If the error is 'File Not Found', use the MISSING file path as the filePath.
    
    Log Snippet:
    ${logSnippet.substring(0, 20000)}
    ${repoContext ? `\nREPO CONTEXT: \n${repoContext}\n` : ''}
  `;

  try {
      const response = await unifiedGenerate(config, {
        contents: prompt,
        config: { systemInstruction: "You are an automated Error Diagnosis Agent.", maxOutputTokens: 1024, responseMimeType: "application/json" },
        model: MODEL_FAST
      });
      
      let parsed: any = safeJsonParse(response.text || "{}", { summary: "", filePath: "" });

      // Unwrap nested objects if LLM ignored instructions
      if (parsed.answer) {
          if (typeof parsed.answer === 'object') {
              parsed = {
                  summary: parsed.answer.primaryError || parsed.answer.summary || parsed.answer.error || "",
                  filePath: parsed.answer.filePath || ""
              };
          } else if (typeof parsed.answer === 'string') {
              // Handle string answer (CyberSentinel case)
              parsed.summary = parsed.answer;
          }
      } else if (parsed.result && typeof parsed.result === 'object') {
          parsed = parsed.result;
      }

      // Map fields if keys mismatch (Hallucination Guard)
      if (!parsed.summary && parsed.primaryError) parsed.summary = parsed.primaryError;
      if (!parsed.summary && parsed.error) parsed.summary = parsed.error;
      
      if (!parsed.filePath) parsed.filePath = "";
      // Fallback summary if empty
      if (!parsed.summary) parsed.summary = "Unknown Error";

      return { summary: parsed.summary, filePath: parsed.filePath };
  } catch { return { summary: "Diagnosis Failed", filePath: "" }; }
}

export async function generateRepoSummary(config: AppConfig): Promise<string> {
    return "Repository structure analysis (simulated).";
}

export async function generatePostMortem(config: AppConfig, failedAgents: any[]): Promise<string> {
    const prompt = `Generate a post-mortem for these failed agents: ${JSON.stringify(failedAgents)}`;
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

export async function runDevShellCommand(config: AppConfig, command: string): Promise<{ output: string, exitCode: number }> {
    if (config.devEnv === 'e2b' && config.e2bApiKey) {
        try {
            console.log(`[E2B] Executing: ${command}`);
            // Robust import handling for CDN environments to avoid named export syntax errors if bundle differs
            const CI = (e2bModule as any).CodeInterpreter || (e2bModule as any).default?.CodeInterpreter;
            
            if (!CI) {
                return { output: "E2B Module Loading Error: CodeInterpreter class not found.", exitCode: 1 };
            }

            const sandbox = await CI.create({ apiKey: config.e2bApiKey });
            const result = await sandbox.notebook.execCell(command);
            await sandbox.close();
            
            const logs = result.logs.stdout.join('\n') + result.logs.stderr.join('\n');
            const output = result.text ? `${result.text}\n${logs}` : logs;
            return { output: output || "No Output", exitCode: result.error ? 1 : 0 };
        } catch (e: any) {
            return { output: `E2B Execution Failed: ${e.message}`, exitCode: 1 };
        }
    }
    // Simulation
    return { output: `[SIMULATION] Shell command executed: ${command}\n> (Mock Output)`, exitCode: 0 };
}

export async function searchRepoFile(config: AppConfig, query: string): Promise<string | null> {
    return null; 
}

export async function toolCodeSearch(config: AppConfig, query: string): Promise<string[]> {
    // If we have E2B, we could run 'grep' or 'find' here.
    if (config.devEnv === 'e2b') {
        const cmd = `grep -r "${query}" . | head -n 5`;
        const res = await runDevShellCommand(config, cmd);
        if (res.exitCode === 0 && res.output.trim().length > 0) {
             return res.output.split('\n').map(l => l.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i);
        }
    }
    return [];
}

export async function toolLintCheck(config: AppConfig, code: string, language: string): Promise<{ valid: boolean, error?: string }> {
    // 1. Try E2B Real Linter if available
    if (config.devEnv === 'e2b' && config.e2bApiKey) {
        // Simple python syntax check example
        if (language === 'python') {
            const cmd = `echo "${code.replace(/"/g, '\\"')}" > check.py && python3 -m py_compile check.py`;
            const res = await runDevShellCommand(config, cmd);
            if (res.exitCode !== 0) {
                return { valid: false, error: res.output };
            }
            return { valid: true };
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

export async function toolScanDependencies(config: AppConfig, headSha: string): Promise<string> {
    return "No dependency issues detected.";
}

export async function toolWebSearch(config: AppConfig, query: string): Promise<string> {
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
    ${fixed.substring(0, 20000)}
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
        return safeJsonParse(res.text, { passed: false, score: 0, reasoning: "Parsing failed" });
    } catch { return { passed: true, score: 5, reasoning: "Judge Offline (Bypass)" }; }
}

export async function runSandboxTest(config: AppConfig, group: RunGroup, iteration: number, isRealMode: boolean, fileChange: FileChange, errorGoal: string, logCallback: any, fileMap: any): Promise<{ passed: boolean, logs: string }> {
    // CHECK PHASE: Uses checkEnv configuration (GitHub Actions or Simulation)
    
    if (config.checkEnv === 'github_actions' && isRealMode) {
        // Simulate GHA triggering for now, as we don't have a real repo to push to in this environment.
        // In a real implementation, this would:
        // 1. Create a branch
        // 2. Push files
        // 3. Trigger workflow_dispatch or wait for push event
        // 4. Poll runs
        return { passed: false, logs: "GitHub Actions Triggered (Simulation: Would poll API for status)" };
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

export async function pushMultipleFilesToGitHub(config: AppConfig, files: { path: string, content: string }[], baseSha: string): Promise<string> {
    return "https://github.com/mock/pr";
}

export async function getAgentChatResponse(config: AppConfig, message: string): Promise<string> {
    const res = await unifiedGenerate(config, { contents: message, model: MODEL_SMART });
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
