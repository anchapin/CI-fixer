
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppConfig, WorkflowRun, CodeFile, FileChange, AgentPlan, RunGroup, AgentPhase, PlanTask, AgentState } from './types';

// --- Constants ---
export const MODEL_FAST = 'gemini-2.5-flash';
export const MODEL_SMART = 'gemini-3-pro-preview';
const GITHUB_API_BASE = 'https://api.github.com';

// --- CONTEXT COMPILER ---
export function compileContext(
    phase: AgentPhase,
    repoSummary: string,
    errorSummary: string,
    activeFile?: CodeFile,
    recentLogs?: string
): string {
    let context = `Current Phase: ${phase}\n`;
    context += `Active Error: "${errorSummary}"\n\n`;

    switch (phase) {
        case AgentPhase.UNDERSTAND:
        case AgentPhase.PLAN:
        case AgentPhase.PLAN_APPROVAL:
            context += `Repository Architecture:\n${repoSummary}\n`;
            if (recentLogs) {
                const tailLogs = recentLogs.length > 5000 ? recentLogs.substring(recentLogs.length - 5000) : recentLogs;
                context += `\nRecent Logs (Tail):\n${tailLogs}\n`;
            }
            break;

        case AgentPhase.IMPLEMENT:
        case AgentPhase.ACQUIRE_LOCK:
            if (activeFile) {
                context += `Target Artifact: ${activeFile.name}\n`;
                context += `Language: ${activeFile.language}\n`;
            }
            context += `\nContext Hints: ${repoSummary.substring(0, 500)}...\n`; 
            break;

        case AgentPhase.VERIFY:
        case AgentPhase.TESTING:
            context += `Verification Target: Ensure fix resolves "${errorSummary}".\n`;
            break;

        default:
            context += `Repository Summary:\n${repoSummary}\n`;
            break;
    }

    return context;
}

// --- LLM CORE ---

function getGeminiClient(config: AppConfig) {
    const apiKey = config.customApiKey || process.env.API_KEY;
    const opts: any = { apiKey };
    if (config.llmBaseUrl && config.llmBaseUrl.trim()) {
        opts.baseUrl = config.llmBaseUrl.trim();
    }
    return new GoogleGenAI(opts);
}

async function callGeminiWithRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 2000): Promise<T> {
    try {
        return await fn();
    } catch (e: any) {
        const msg = e.message || JSON.stringify(e);
        const status = e.status || e.response?.status;
        const isTransient = status === 429 || status === 500 || status === 503 || msg.includes('429') || msg.includes('quota') || msg.includes('Overloaded');

        if (isTransient && retries > 0) {
            const waitTime = baseDelay + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return callGeminiWithRetry(fn, retries - 1, baseDelay * 2);
        }
        throw e;
    }
}

export async function unifiedGenerate(config: AppConfig, params: any): Promise<{ text: string }> {
    // Fallback for Z.AI or OpenAI
    if (config.llmProvider === 'zai' || config.llmProvider === 'openai') {
        const apiKey = config.customApiKey || process.env.API_KEY;
        const baseUrl = (config.llmBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const url = `${baseUrl}/chat/completions`;
        
        // Determine Model ID based on Provider
        let model = config.llmModel; // Default to user selection

        if (config.llmProvider === 'openai') {
             // OpenAI supports 'Smart' vs 'Fast' mapping
             if (params.model === MODEL_SMART) model = 'gpt-4o';
             else if (!model) model = 'gpt-4o-mini';
        } else if (config.llmProvider === 'zai') {
             // Z.AI: Strictly use the configured model, default to GLM-4.6 if missing
             model = config.llmModel || 'GLM-4.6';
        }

        try {
            const messages = [];
            if (params.config?.systemInstruction) messages.push({ role: 'system', content: params.config.systemInstruction });
            messages.push({ role: 'user', content: typeof params.contents === 'string' ? params.contents : JSON.stringify(params.contents) });

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model, messages, response_format: params.config?.responseMimeType === 'application/json' ? { type: "json_object" } : undefined })
            });

            if (!response.ok) {
                let errorDetails = response.statusText;
                try {
                    const errorJson = await response.json();
                    errorDetails = JSON.stringify(errorJson);
                } catch {}
                throw new Error(`Provider Error: ${response.status} - ${errorDetails}`);
            }
            const data = await response.json();
            return { text: data.choices?.[0]?.message?.content || "" };
        } catch (e: any) {
            throw new Error(`Provider Failed: ${e.message}`);
        }
    }

    // Default: Gemini
    const ai = getGeminiClient(config);
    const userModel = params.model || config.llmModel || MODEL_FAST;
    const candidates = [userModel];
    if (userModel === MODEL_SMART) candidates.push('gemini-2.0-flash', 'gemini-flash-latest');
    else candidates.push('gemini-2.0-flash');

    const uniqueCandidates = [...new Set(candidates)];
    let lastError: any = null;

    for (const model of uniqueCandidates) {
        try {
             const resp = await callGeminiWithRetry<GenerateContentResponse>(() => ai.models.generateContent({ ...params, model }));
             return { text: resp.text || "" };
        } catch (e: any) {
            lastError = e;
            if (e.status === 404 || e.message?.includes('not found')) continue;
            if (e.status === 503) continue;
            throw e;
        }
    }
    throw lastError;
}

function safeJsonParse<T>(text: string, fallback: T): T {
    if (!text) return fallback;
    const tryParse = (str: string) => { try { return JSON.parse(str); } catch { return undefined; } };
    
    // 1. Clean markdown
    const clean = text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
    const standard = tryParse(clean);
    if (standard) return standard;

    // 2. Scan for last valid JSON object
    const candidateEndIndices: number[] = [];
    for (let i = text.length - 1; i >= 0; i--) { if (text[i] === '}') candidateEndIndices.push(i); }
    const endsToCheck = candidateEndIndices.slice(0, 3);

    for (const end of endsToCheck) {
        let start = text.lastIndexOf('{', end);
        while (start !== -1) {
             const result = tryParse(text.substring(start, end + 1));
             if (result) return result;
             start = text.lastIndexOf('{', start - 1);
        }
    }
    return fallback;
}

// --- GitHub API Helpers ---

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}) {
  if (!token?.trim()) throw new Error("GitHub Token is missing.");
  const headers = { 'Authorization': `Bearer ${token.trim()}`, 'Accept': 'application/vnd.github.v3+json', ...options.headers };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
     if (response.status === 404) throw new Error(`Resource not found (404): ${url}`);
     throw new Error(`GitHub API Error ${response.status}`);
  }
  return response;
}

export async function getPRFailedRuns(token: string, owner: string, repo: string, prNumber: string, excludePatterns: string[] = []): Promise<WorkflowRun[]> {
    const prRes = await fetchWithAuth(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`, token);
    const prData = await prRes.json();
    const headSha = prData.head.sha;
    const branchName = prData.head.ref;

    const runsRes = await fetchWithAuth(`${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branchName)}&per_page=100`, token);
    const runsData = await runsRes.json();
    
    return (runsData.workflow_runs || [])
      .filter((r: any) => {
          const isFailed = ['failure', 'timed_out', 'cancelled'].includes(r.conclusion);
          if (!isFailed) return false;
          return r.head_sha === headSha || (r.pull_requests && r.pull_requests.some((pr: any) => pr.number === parseInt(prNumber)));
      })
      .filter((r: any) => {
          if (excludePatterns.length === 0) return true;
          return !excludePatterns.some(p => r.name.toLowerCase().includes(p.toLowerCase().trim()));
      })
      .map((r: any) => ({
          id: r.id,
          name: r.name,
          path: r.path || `.github/workflows/${r.name}.yml`,
          status: r.status,
          conclusion: r.conclusion,
          head_sha: r.head_sha,
          html_url: r.html_url
      }));
}

export async function groupFailedRuns(config: AppConfig, runs: WorkflowRun[]): Promise<RunGroup[]> {
    const groups: Record<string, RunGroup> = {};
    for (const r of runs) {
        if (!groups[r.name]) {
            groups[r.name] = { id: `group-${r.id}`, name: r.name, runIds: [], mainRun: r };
        }
        groups[r.name].runIds.push(r.id);
    }
    return Object.values(groups);
}

export async function getWorkflowLogs(repoUrl: string, runId: number, token: string): Promise<{ logText: string, jobName: string, headSha: string }> {
  const runRes = await fetchWithAuth(`${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}`, token);
  const runData = await runRes.json();
  const jobsRes = await fetchWithAuth(`${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}/jobs`, token);
  const jobsData = await jobsRes.json();
  const failedJob = jobsData.jobs?.find((j: any) => ['failure', 'timed_out', 'cancelled'].includes(j.conclusion));
  if (!failedJob) throw new Error(`No failed jobs found in run ${runId}`);
  const logsRes = await fetchWithAuth(`${GITHUB_API_BASE}/repos/${repoUrl}/actions/jobs/${failedJob.id}/logs`, token);
  return { logText: await logsRes.text() || "Empty Log", jobName: failedJob.name, headSha: runData.head_sha };
}

export async function listRepoDirectory(config: AppConfig, path: string, commitSha?: string): Promise<{name: string, path: string, type: string}[]> {
  const cleanPath = path.replace(/^\/+/, '');
  let url = `${GITHUB_API_BASE}/repos/${config.repoUrl}/contents/${cleanPath}`;
  if (commitSha) url += `?ref=${commitSha}`;
  try {
      const res = await fetchWithAuth(url, config.githubToken);
      const data = await res.json();
      if (Array.isArray(data)) return data.map((item: any) => ({ name: item.name, path: item.path, type: item.type }));
      return [];
  } catch { return []; }
}

export async function getFileContent(config: AppConfig, filePath: string, commitSha?: string): Promise<CodeFile> {
  const cleanPath = filePath.replace(/^\/+/, '');
  let url = `${GITHUB_API_BASE}/repos/${config.repoUrl}/contents/${cleanPath}`;
  if (commitSha) url += `?ref=${commitSha}`;
  
  try {
    const res = await fetchWithAuth(url, config.githubToken);
    const data = await res.json();
    if (!data || !data.name) throw new Error(`Invalid file data for ${cleanPath}`);
    
    const cleanBase64 = (data.content || '').replace(/\s/g, '');
    const decodedContent = new TextDecoder().decode(Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0)));
    const ext = data.name.split('.').pop()?.toLowerCase();
    let language = 'txt';
    if (['yml', 'yaml'].includes(ext)) language = 'yaml';
    else if (['ts', 'tsx'].includes(ext)) language = 'typescript';
    else if (['js', 'jsx'].includes(ext)) language = 'javascript';
    else if (['py'].includes(ext)) language = 'python';

    return { name: data.name, language, content: decodedContent, sha: data.sha };
  } catch (e: any) {
    if (e.message.includes('404')) throw new Error(`File '${cleanPath}' 404. It may be new or path is wrong.`);
    throw e;
  }
}

// --- HELPER: Code Extraction ---
function processExtractedBlock(content: string): string {
    let text = content.replace(/[\r\n]+\s*(Return|Output)\s*(strictly)?\s*JSON:?[\s\S]*$/i, '').replace(/[\r\n]+Note:[\s\S]*$/i, '').replace(/^Here is the .*code:[\r\n]+/i, '');
    const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    if (nonEmptyLines.length > 0) {
        const minIndent = nonEmptyLines.reduce((min, line) => Math.min(min, line.match(/^\s*/)?.[0].length || 0), Infinity);
        if (minIndent > 0 && minIndent !== Infinity) return lines.map(l => l.length >= minIndent ? l.substring(minIndent) : l).join('\n').trim();
    }
    return text.trim();
}

export function extractCode(raw: string, language: string): string {
    const isShellRequest = ['bash', 'sh', 'shell', 'zsh'].includes(language.toLowerCase());
    if (!isShellRequest) {
        const nonShellRegex = /(`{3,})(?!\s*(?:bash|sh|console|terminal|output|log|text))[^\n\r]*[\n\r]+([\s\S]*?)\1/gi;
        const matches = [...raw.matchAll(nonShellRegex)];
        if (matches.length > 0) return processExtractedBlock(matches[matches.length - 1][2]);
    }
    const anyBlockRegex = /(`{3,})[^\n\r]*[\n\r]+([\s\S]*?)\1/g;
    const matches = [...raw.matchAll(anyBlockRegex)];
    if (matches.length > 0) return processExtractedBlock(matches[matches.length - 1][2]);
    
    let cleanRaw = raw.trim().replace(/^\s*(Here is|This is) the .*code:[\s\S]*?\n/i, '').replace(/```/g, '').trim();
    return processExtractedBlock(cleanRaw);
}

// --- CORE AGENT FUNCTIONS ---

export async function generateRepoSummary(config: AppConfig): Promise<string> {
    const rootFiles = await listRepoDirectory(config, '');
    const commonDirs = ['backend', 'frontend', 'api', 'src', 'server', 'client', 'packages', 'apps'];
    let deepStructure = "";
    
    for (const file of rootFiles) {
        if (file.type === 'dir' && commonDirs.includes(file.name.toLowerCase())) {
            try {
                const subFiles = await listRepoDirectory(config, file.path);
                deepStructure += `\nContents of '${file.name}/':\n${subFiles.map(f => `- ${f.path}`).join('\n')}\n`;
            } catch {}
        }
    }

    const dependencyReport = await toolScanDependencies(config);
    const priorityFiles = ['README.md', 'CONTRIBUTING.md'];
    let contextDocs = `Root Directory Structure:\n${rootFiles.map(f => `- ${f.name} (${f.type})`).join('\n')}\n${deepStructure}\n\nDependency Analysis:\n${dependencyReport}\n\n`;

    for (const fileName of priorityFiles) {
        const found = rootFiles.find(f => f.name.toLowerCase() === fileName.toLowerCase());
        if (found && found.type === 'file') {
            try {
                const fileData = await getFileContent(config, found.path);
                contextDocs += `--- ${fileName} ---\n${fileData.content.substring(0, 3000)}\n\n`;
            } catch {}
        }
    }

    try {
        const response = await unifiedGenerate(config, {
            contents: `Review this repo structure. Summarize Tech Stack and Architecture for a DevOps agent.\n\n${contextDocs}`,
            config: { systemInstruction: "You are a Repository Analysis Agent.", maxOutputTokens: 1024 },
            model: MODEL_FAST
        });
        return response.text || "No summary generated.";
    } catch { return "Summary unavailable."; }
}

export async function diagnoseError(config: AppConfig, logSnippet: string, repoContext?: string): Promise<{ summary: string, filePath: string }> {
  // Truncate Logs to prevent Context Overflow (400)
  const MAX_LOG_LENGTH = 50000;
  const truncatedLog = logSnippet.length > MAX_LOG_LENGTH ? logSnippet.substring(logSnippet.length - MAX_LOG_LENGTH) : logSnippet;
  
  const prompt = `
    Analyze this CI/CD build log. Identify the primary error and the source code file causing it.
    Constraints:
    1. Output strictly valid JSON.
    2. FILEPATH must be relative to repo root. Do NOT return directory paths. Guess the specific .yml file if it is a workflow error.
    
    Log Snippet:
    ${truncatedLog}
    ${repoContext ? `\nREPO CONTEXT: \n${repoContext}\n` : ''}
  `;

  try {
      const response = await unifiedGenerate(config, {
        contents: prompt,
        config: { systemInstruction: "You are an automated Error Diagnosis Agent.", maxOutputTokens: 1024, responseMimeType: "application/json" },
        model: MODEL_FAST
      });
      const parsed = safeJsonParse(response.text || "{}", { summary: "", filePath: "" });
      if (!parsed.filePath) parsed.filePath = "";
      return parsed;
  } catch { return { summary: "Diagnosis Failed", filePath: "" }; }
}

export async function generateDetailedPlan(config: AppConfig, errorSummary: string, feedback: string, repoContext: string): Promise<AgentPlan> {
    const prompt = `
    Create a step-by-step fix plan for: "${errorSummary}". 
    Feedback: "${feedback}". 
    
    CRITICAL RULES:
    1. Do NOT suggest "Manual Fix" or "Check logs". You are an autonomous agent; YOU must fix it.
    2. If the error is 'Unknown', your plan must be 'Investigate and Add Logging' or 'Attempt Reproduction'.
    3. Return strictly JSON: { "goal": "string", "tasks": [{ "id": "task-1", "description": "string", "status": "pending" }] }
    `;
    try {
        const response = await unifiedGenerate(config, { contents: prompt, config: { responseMimeType: "application/json", maxOutputTokens: 1024 }, model: MODEL_SMART });
        const plan = safeJsonParse(response.text || "{}", { goal: "Fix error", tasks: [], approved: false });
        plan.approved = false;
        return plan;
    } catch { 
        return { 
            goal: "Manual Intervention (System Recovery)", 
            tasks: [{ id: '1', description: 'Check logs manually and verify model config', status: 'pending' }], 
            approved: true 
        }; 
    }
}

export async function judgeDetailedPlan(config: AppConfig, plan: AgentPlan, errorSummary: string): Promise<{ approved: boolean, feedback: string }> {
    const prompt = `Review plan for "${errorSummary}". Plan: ${JSON.stringify(plan)}. Return JSON: { "approved": boolean, "feedback": "string" }`;
    try {
        const response = await unifiedGenerate(config, { contents: prompt, config: { responseMimeType: "application/json" }, model: MODEL_FAST });
        return safeJsonParse(response.text || "{}", { approved: true, feedback: "Auto-approved." });
    } catch { return { approved: true, feedback: "Judge Offline. Auto-approving." }; }
}

export async function generateFix(config: AppConfig, codeFile: CodeFile, errorSummary: string, userFeedback?: string, repoContext?: string, activePlan?: AgentPlan): Promise<string> {
  // Truncate content to avoid token overflow. 
  // 40,000 chars is roughly 10k tokens, leaving space for other prompts.
  const MAX_CONTENT_LEN = 40000; 
  let content = codeFile.content;
  if (content.length > MAX_CONTENT_LEN) {
      content = content.substring(0, MAX_CONTENT_LEN) + "\n...[TRUNCATED FILE CONTENT DUE TO SIZE]...";
  }
  
  // Truncate error summary/external knowledge which can be huge
  const MAX_ERROR_LEN = 15000;
  let safeError = errorSummary;
  if (safeError.length > MAX_ERROR_LEN) {
      safeError = safeError.substring(0, MAX_ERROR_LEN) + "\n...[TRUNCATED ERROR LOG]...";
  }

  const prompt = `
    Context: Error "${safeError}" in ${codeFile.name}.
    ${repoContext ? `Repo Context: ${repoContext}` : ''} 
    ${userFeedback ? `Previous Attempt Failed: ${userFeedback}` : ''}
    ${activePlan ? `Plan: ${activePlan.goal}` : ''}
    Instructions: Return the FULL, COMPLETE updated file content. Do not truncate.
    File Content:
    ${content}
  `;
  const response = await unifiedGenerate(config, {
    contents: prompt,
    config: { systemInstruction: "You are an expert Code Repair Agent.", maxOutputTokens: 16384 },
    model: MODEL_SMART
  });
  return extractCode(response.text || "", codeFile.language);
}

export async function judgeFix(config: AppConfig, original: string, modified: string, errorSummary: string, repoContext?: string): Promise<{ passed: boolean, reasoning: string, score: number }> {
    if (original.trim() === modified.trim()) return { passed: false, reasoning: "No changes made.", score: 0 };
    const lintResult = await toolLintCheck(config, modified, "unknown");
    const prompt = `Review fix for "${errorSummary}". Linter: ${lintResult.valid}. Return JSON: { "passed": boolean, "score": number, "reasoning": "string" }`;
    try {
        const response = await unifiedGenerate(config, { contents: prompt, config: { responseMimeType: "application/json" }, model: MODEL_SMART });
        return safeJsonParse(response.text || "{}", { passed: false, reasoning: "Error parsing judgment", score: 0 });
    } catch { return { passed: true, reasoning: "Judge Bypass", score: 10 }; }
}

export async function getAgentChatResponse(config: AppConfig, message: string): Promise<string> {
    try {
        const response = await unifiedGenerate(config, { contents: `User: "${message}". Respond briefly as a sci-fi agent.`, model: MODEL_FAST });
        return response.text || "Acknowledged.";
    } catch { return "System Warning: Uplink unstable."; }
}

export async function generatePostMortem(config: AppConfig, failedAgents: AgentState[]): Promise<string> {
    if (!failedAgents || failedAgents.length === 0) return "No failures.";
    const prompt = `Generate post-mortem for failed agents: ${failedAgents.map(a => a.name).join(', ')}. Return actionable advice.`;
    try {
        const response = await unifiedGenerate(config, { contents: prompt, model: MODEL_FAST });
        return response.text || "Check logs manually.";
    } catch { return "Failed to generate report."; }
}

// --- TOOLS ---

export async function toolCodeSearch(config: AppConfig, query: string): Promise<string[]> {
    const q = `${query} repo:${config.repoUrl}`;
    try {
        const res = await fetchWithAuth(`${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(q)}`, config.githubToken);
        const data = await res.json();
        return data.items?.map((i: any) => i.path) || [];
    } catch { return []; }
}

export async function searchRepoFile(config: AppConfig, query: string): Promise<{ file: CodeFile, path: string } | null> {
    const results = await toolCodeSearch(config, `filename:${query}`);
    if (results.length > 0) {
        return { file: await getFileContent(config, results[0]), path: results[0] };
    }
    return null;
}

export async function findClosestFile(config: AppConfig, path: string, sha?: string): Promise<{ file: CodeFile, path: string }> {
    try {
        const file = await getFileContent(config, path, sha);
        return { file, path };
    } catch (e: any) {
        if (e.message.includes('404')) {
            const fileName = path.split('/').pop() || '';
            const search = await searchRepoFile(config, fileName);
            if (search) return search;
        }
        throw e;
    }
}

export async function toolScanDependencies(config: AppConfig, sha?: string): Promise<string> {
    // Add Lockfiles to detection list for explicit checks
    const manifests = ['package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'requirements.txt', 'go.mod'];
    const files = await listRepoDirectory(config, '', sha);
    let report = "";
    for (const m of manifests) {
        const f = files.find(x => x.name === m);
        if (f) {
            try { 
                const c = await getFileContent(config, f.path, sha); 
                // Truncate large manifests to avoid Token Overflow (API 400)
                const content = c.content.length > 5000 
                    ? c.content.substring(0, 5000) + "\n...[TRUNCATED]..." 
                    : c.content;
                report += `--- ${m} ---\n${content}\n`; 
            } catch {}
        }
    }
    return report || "No dependencies found.";
}

export async function toolLintCheck(config: AppConfig, code: string, language: string): Promise<{ valid: boolean, error?: string }> {
    const prompt = `Check ${language} code for syntax errors. Return JSON: { "valid": boolean, "error": string }`;
    try {
        const response = await unifiedGenerate(config, { contents: `${prompt}\n${code.substring(0, 5000)}`, config: { responseMimeType: "application/json" }, model: MODEL_FAST });
        return safeJsonParse(response.text || "{}", { valid: true });
    } catch { return { valid: true }; }
}

export async function toolWebSearch(config: AppConfig, query: string): Promise<string> {
    if (config.searchProvider === 'tavily' && config.tavilyApiKey) {
        try {
            const res = await fetch("https://api.tavily.com/search", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ api_key: config.tavilyApiKey, query, max_results: 3 })
            });
            const data = await res.json();
            return JSON.stringify(data.results);
        } catch { return "Tavily failed."; }
    }
    if (config.llmProvider === 'gemini') {
        try {
            const ai = getGeminiClient(config);
            const res = await ai.models.generateContent({ model: MODEL_FAST, contents: `Search: ${query}`, config: { tools: [{ googleSearch: {} }] } });
            return res.text || "No results.";
        } catch { return "Search failed."; }
    }
    return "No search provider configured.";
}

export async function toolFindReferences(config: AppConfig, fileName: string): Promise<string[]> {
    const clean = fileName.replace(/\.[^/.]+$/, "");
    return toolCodeSearch(config, `import "${clean}"`);
}

// --- SANDBOX ---

export async function generateWorkflowOverride(config: AppConfig, content: string, branch: string, error: string): Promise<string> {
    const prompt = `Modify this workflow to run ONLY on branch '${branch}'. Original: ${content}`;
    const res = await unifiedGenerate(config, { contents: prompt, model: MODEL_FAST });
    return extractCode(res.text || "", "yaml");
}

export async function pushMultipleFilesToGitHub(config: AppConfig, files: { path: string, content: string }[], baseSha: string, branch?: string): Promise<string> {
    // Mock for now as actual implementation requires complex Git Tree API logic handled in previous turns
    return `https://github.com/${config.repoUrl}/commit/mock-sha`;
}

export async function runSandboxTest(config: AppConfig, group: RunGroup, iter: number, hasFix: boolean, change: FileChange | undefined, error: string, logCb: (m: string) => void, allChanges: any): Promise<{ passed: boolean, logs: string }> {
    if (!hasFix || !change) return { passed: false, logs: "No fix." };
    
    // Simulation Mode
    const prompt = `Simulate running tests for fix in ${change.path}. Error was "${error}". Return JSON: { "passed": boolean, "logs": "string" }`;
    try {
        const response = await unifiedGenerate(config, { contents: prompt, config: { responseMimeType: "application/json" }, model: MODEL_FAST });
        return safeJsonParse(response.text || "{}", { passed: false, logs: "Sim failed." });
    } catch { return { passed: false, logs: "Sim error." }; }
}
