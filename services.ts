
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppConfig, CodeFile, WorkflowRun, RunGroup, FileChange, AgentState, AgentPhase, AgentPlan, LogLine } from './types';

// --- Constants ---
const GITHUB_API_BASE = 'https://api.github.com';
const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_SMART = 'gemini-3-pro-preview';

// --- GitHub API Helpers ---

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}) {
  const cleanToken = token.trim();
  
  if (!cleanToken) {
    throw new Error("GitHub Token is missing. Please check your configuration.");
  }

  const headers = {
    'Authorization': `Bearer ${cleanToken}`,
    'Accept': 'application/vnd.github.v3+json',
    ...options.headers,
  };
  
  const response = await fetch(url, { ...options, headers });
  
  if (!response.ok) {
    // Try to parse error body
    let errorDetails = "";
    try {
        const errJson = await response.json();
        errorDetails = errJson.message || JSON.stringify(errJson);
    } catch {
        errorDetails = response.statusText;
    }

    if (response.status === 401) {
       throw new Error(`GitHub Authentication Failed (401): ${errorDetails}`);
    }
    if (response.status === 403) {
       throw new Error(`GitHub Access Forbidden (403): ${errorDetails}`);
    }
    if (response.status === 404) {
       throw new Error(`Resource not found (404): ${url}`);
    }
    if (response.status === 422) {
       throw new Error(`GitHub Validation Error (422): ${errorDetails}. Check if file paths are valid or if the repository allows direct commits.`);
    }
    throw new Error(`GitHub API Error ${response.status}: ${errorDetails}`);
  }
  return response;
}

// Fetch PR info to get Repo and HEAD SHA, then find failed runs
export async function getPRFailedRuns(
    githubToken: string, 
    owner: string, 
    repo: string, 
    prNumber: string,
    excludePatterns: string[] = [] // New optional parameter
): Promise<WorkflowRun[]> {
    const prUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`;
    const prRes = await fetchWithAuth(prUrl, githubToken);
    const prData = await prRes.json();
    const headSha = prData.head.sha;

    // FIX: Increased page size to 100 to retrieve relevant runs if many spam runs exist
    const runsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=100`;
    const runsRes = await fetchWithAuth(runsUrl, githubToken);
    const runsData = await runsRes.json();
    
    // Parse the runs and ensure path is included
    return (runsData.workflow_runs || [])
      .filter((r: any) => r.conclusion === 'failure')
      // FIX: Filter out based on provided patterns (case-insensitive)
      .filter((r: any) => {
          if (excludePatterns.length === 0) return true;
          const name = r.name.toLowerCase();
          return !excludePatterns.some(p => name.includes(p.toLowerCase().trim()));
      })
      .map((r: any) => ({
          id: r.id,
          name: r.name,
          path: r.path || `.github/workflows/${r.name}.yml`, // Fallback if API doesn't provide path
          status: r.status,
          conclusion: r.conclusion,
          head_sha: r.head_sha,
          html_url: r.html_url
      }));
}

export async function getWorkflowLogs(repoUrl: string, runId: number, githubToken: string): Promise<{ logText: string, jobName: string, headSha: string }> {
  const runUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}`;
  const runRes = await fetchWithAuth(runUrl, githubToken);
  const runData = await runRes.json();
  const headSha = runData.head_sha;

  const jobsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}/jobs`;
  const jobsRes = await fetchWithAuth(jobsUrl, githubToken);
  const jobsData = await jobsRes.json();
  
  const failedJob = jobsData.jobs?.find((j: any) => j.conclusion === 'failure');
  if (!failedJob) throw new Error(`No failed jobs found in run ${runId}`);

  const logsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/jobs/${failedJob.id}/logs`;
  const logsRes = await fetchWithAuth(logsUrl, githubToken);
  const logsResText = await logsRes.text();

  return { logText: logsResText || "Empty Log", jobName: failedJob.name, headSha };
}

export async function getFileContent(config: AppConfig, filePath: string, commitSha?: string): Promise<CodeFile> {
  const { repoUrl, githubToken } = config;
  const cleanPath = filePath.replace(/^\/+/, '');
  
  let url = `${GITHUB_API_BASE}/repos/${repoUrl}/contents/${cleanPath}`;
  if (commitSha) url += `?ref=${commitSha}`;
  
  try {
    const res = await fetchWithAuth(url, githubToken);
    const data = await res.json();
    
    const cleanBase64 = (data.content || '').replace(/\s/g, '');
    const decodedContent = new TextDecoder().decode(
      Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0))
    );

    // Better language detection
    const ext = data.name.split('.').pop()?.toLowerCase();
    let language = 'txt';
    if (data.name.toLowerCase() === 'dockerfile' || data.name.toLowerCase().includes('dockerfile')) {
        language = 'dockerfile';
    } else if (['yml', 'yaml'].includes(ext)) {
        language = 'yaml';
    } else if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
        language = 'javascript';
    } else if (['py'].includes(ext)) {
        language = 'python';
    } else if (ext) {
        language = ext;
    }

    return {
      name: data.name,
      language: language,
      content: decodedContent,
      sha: data.sha 
    };
  } catch (e: any) {
    if (e.message.includes('404')) {
        throw new Error(`File '${cleanPath}' 404. It may be new or path is wrong.`);
    }
    throw e;
  }
}

export async function listRepoDirectory(config: AppConfig, path: string, commitSha?: string): Promise<{name: string, path: string, type: string}[]> {
  const { repoUrl, githubToken } = config;
  const cleanPath = path.replace(/^\/+/, '');
  let url = `${GITHUB_API_BASE}/repos/${repoUrl}/contents/${cleanPath}`;
  if (commitSha) url += `?ref=${commitSha}`;
  
  try {
      const res = await fetchWithAuth(url, githubToken);
      const data = await res.json();
      if (Array.isArray(data)) {
          return data.map((item: any) => ({ name: item.name, path: item.path, type: item.type }));
      }
      return [];
  } catch (e) {
      console.warn(`Failed to list directory ${cleanPath}:`, e);
      return [];
  }
}

// --- HELPER: Code Extraction (Fix Prompt Leakage) ---
function extractCode(raw: string, language: string): string {
    // 1. Try to find markdown blocks specifically for the language
    const langPattern = new RegExp(`\`\`\`${language}([\\s\\S]*?)\`\`\``, 'i');
    const langMatch = raw.match(langPattern);
    if (langMatch && langMatch[1]) return langMatch[1].trim();

    // 2. Try generic markdown blocks
    const genericMatch = raw.match(/```([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) return genericMatch[1].trim();

    // 3. Fallback: If no blocks, but raw text looks like it contains the JSON prompt leak, strip it
    // Remove common "Return JSON" instructions if they appear at the end
    let clean = raw.replace(/Return JSON:[\s\S]*$/, '').trim();
    
    // Remove "Here is the code:" prefixes (Safety check: only for code-like files)
    if (['python', 'javascript', 'typescript', 'java', 'go'].includes(language) || language === 'python') {
        clean = clean.replace(/^[\s\S]*?import /, 'import ').replace(/^[\s\S]*?def /, 'def ');
    }
    
    return clean;
}

// --- TOOL 1: CODEBASE SEARCH (grep) ---
export async function toolCodeSearch(config: AppConfig, query: string): Promise<string[]> {
    const { repoUrl, githubToken } = config;
    // Sanitize query: Remove newlines, excessively long strings, and special shell chars if any
    const cleanQuery = query.split('\n')[0].replace(/[^\w\s\.-]/g, ' ').substring(0, 50).trim();
    
    if (!cleanQuery) return [];

    // Uses GitHub Search API to simulate grep
    const q = `repo:${repoUrl} ${cleanQuery}`;
    const url = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(q)}`;
    
    try {
        const res = await fetchWithAuth(url, githubToken);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
            // Return top 3 matches
            return data.items.slice(0, 3).map((item: any) => item.path);
        }
        return [];
    } catch (e) {
        console.warn("Tool CodeSearch failed", e);
        return [];
    }
}

// --- TOOL 2: SYNTAX VALIDATOR (Linter) ---
export async function toolLintCheck(config: AppConfig, code: string, language: string): Promise<{ valid: boolean, error?: string }> {
    // Since we don't have a backend linter, we use a lightweight LLM call as a "Linter Agent"
    const prompt = `
        You are a strict code syntax validator.
        Check the following ${language} code for syntax errors.
        Ignore logic errors. Only look for missing brackets, indents, colons, or illegal characters.
        
        CODE:
        ${code.substring(0, 3000)}
        
        Return JSON: { "valid": boolean, "error": "string or null" }
    `;
    
    try {
        const response = await unifiedGenerate(config, {
             contents: prompt,
             config: { responseMimeType: "application/json" },
             model: MODEL_FAST
        });
        return safeJsonParse(response.text || "{}", { valid: true });
    } catch {
        return { valid: true }; // Fail open if API fails
    }
}

// --- TOOL 3: DEPENDENCY INSPECTOR ---
export async function toolScanDependencies(config: AppConfig, headSha?: string): Promise<string> {
    const manifestFiles = ['package.json', 'requirements.txt', 'go.mod', 'pom.xml', 'Gemfile'];
    
    // List root files
    const rootFiles = await listRepoDirectory(config, '', headSha);
    const foundManifests = rootFiles.filter(f => manifestFiles.includes(f.name));
    
    if (foundManifests.length === 0) return "No dependency manifest files found in root.";

    let report = "";
    for (const f of foundManifests) {
        try {
            const file = await getFileContent(config, f.path, headSha);
            report += `--- ${f.name} ---\n${file.content.substring(0, 1000)}\n\n`;
        } catch {
            report += `--- ${f.name} (Error reading file) ---\n`;
        }
    }
    return report;
}

// --- TOOL 4: WEB SEARCH (REAL: Tavily or Gemini Grounding) ---
export async function toolWebSearch(config: AppConfig, query: string): Promise<string> {
    
    // OPTION A: TAVILY AI (Recommended for generic agents)
    if (config.searchProvider === 'tavily' && config.tavilyApiKey) {
        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    api_key: config.tavilyApiKey,
                    query: query,
                    search_depth: "basic",
                    include_answer: true,
                    max_results: 3
                })
            });
            
            if (!response.ok) {
                throw new Error(`Tavily API Error: ${response.status}`);
            }
            
            const data = await response.json();
            return `[TAVILY SEARCH RESULTS]\nAnswer: ${data.answer}\n\nSources:\n${data.results.map((r: any) => `- ${r.title}: ${r.content}`).join('\n')}`;
        } catch (e: any) {
            return `[Search Error] Tavily failed: ${e.message}. Using fallback knowledge.`;
        }
    }

    // OPTION B: GEMINI GROUNDING (Google Search)
    // Only available if provider is Gemini
    if (config.llmProvider === 'gemini' || !config.llmProvider) {
        try {
            const ai = getGeminiClient(config);
            const response = await ai.models.generateContent({
                model: MODEL_FAST,
                contents: `Search Google for: "${query}". Summarize the technical solution in 3 sentences.`,
                config: { 
                    tools: [{ googleSearch: {} }] 
                    // NOTE: per instructions, NO responseMimeType when using googleSearch
                }
            });
            
            const text = response.text || "No summary available.";
            
            // Extract sources if available
            let sourcesText = "";
            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
                const links = chunks
                    .map((c: any) => c.web?.uri ? `[${c.web.title || 'Link'}](${c.web.uri})` : null)
                    .filter((l: any) => l)
                    .join(', ');
                if (links) sourcesText = `\nSources: ${links}`;
            }

            return `[GOOGLE SEARCH RESULTS] ${text}${sourcesText}`;
        } catch (e: any) {
             return `[Search Error] Gemini Grounding failed: ${e.message}.`;
        }
    }
    
    // OPTION C: Fallback / Mock (If no key provided)
    return `[Search Warning] No Search Provider configured. Please add Tavily API Key or use Gemini Provider in settings.`;
}

// --- TOOL 5: REFERENCE RESOLVER ---
export async function toolFindReferences(config: AppConfig, fileName: string): Promise<string[]> {
    // Find what files import the target file
    const cleanName = fileName.replace(/\.[^/.]+$/, ""); // remove extension
    return toolCodeSearch(config, `import "${cleanName}" OR from "${cleanName}"`);
}


// Fallback search to find a file if the exact path is wrong
export async function searchRepoFile(config: AppConfig, filename: string): Promise<CodeFile | null> {
    const { repoUrl, githubToken } = config;
    // Limit search to this repo
    const q = `repo:${repoUrl} filename:${filename}`;
    const url = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(q)}`;
    
    try {
        const res = await fetchWithAuth(url, githubToken);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            return getFileContent(config, item.path);
        }
    } catch (e) {
        console.warn("Search failed", e);
    }
    return null;
}

// Smart wrapper to find a file even if the exact path is wrong
export async function findClosestFile(config: AppConfig, filePath: string, commitSha?: string): Promise<CodeFile> {
    try {
        return await getFileContent(config, filePath, commitSha);
    } catch (e: any) {
        if (e.message.includes('404') || e.message.includes('not found')) {
            // Strategy 1: Check if it's a workflow directory issue
            if (filePath.includes('.github/workflows')) {
                const files = await listRepoDirectory(config, '.github/workflows', commitSha);
                // Prefer main.yml, then any yml
                const bestMatch = files.find(f => f.name === 'main.yml') || files.find(f => f.name.endsWith('.yml'));
                if (bestMatch) {
                    return getFileContent(config, bestMatch.path, commitSha);
                }
            }
            
            // Strategy 2: Search API by filename
            const fileName = filePath.split('/').pop();
            if (fileName) {
                const found = await searchRepoFile(config, fileName);
                if (found) return found;
            }
        }
        throw e;
    }
}

// --- GitHub Branch & Workflow Helpers for Real Sandbox ---

async function createBranch(config: AppConfig, baseSha: string, newBranchName: string): Promise<void> {
    const { repoUrl, githubToken } = config;
    const url = `${GITHUB_API_BASE}/repos/${repoUrl}/git/refs`;
    
    try {
        await fetchWithAuth(url, githubToken, {
            method: 'POST',
            body: JSON.stringify({
                ref: `refs/heads/${newBranchName}`,
                sha: baseSha
            })
        });
    } catch (e: any) {
        if (e.message.includes('422')) {
            console.warn(`Branch ${newBranchName} might already exist. Proceeding...`);
        } else {
            throw e;
        }
    }
}

async function deleteBranch(config: AppConfig, branchName: string): Promise<void> {
    const { repoUrl, githubToken } = config;
    const url = `${GITHUB_API_BASE}/repos/${repoUrl}/git/refs/heads/${branchName}`;
    try {
        await fetchWithAuth(url, githubToken, { method: 'DELETE' });
    } catch (e) {
        console.warn(`Failed to cleanup branch ${branchName}:`, e);
    }
}

async function deleteWorkflowRun(config: AppConfig, runId: number): Promise<void> {
    const { repoUrl, githubToken } = config;
    const url = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}`;
    try {
        await fetchWithAuth(url, githubToken, { method: 'DELETE' });
    } catch (e: any) {
        console.warn(`Failed to delete run ${runId}:`, e);
    }
}

async function getRunLogs(config: AppConfig, runId: number): Promise<string> {
    const { repoUrl, githubToken } = config;
    try {
        const jobsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}/jobs`;
        const jobsRes = await fetchWithAuth(jobsUrl, githubToken);
        const jobsData = await jobsRes.json();
        
        // Find failed job first, else use the first one
        const job = jobsData.jobs?.find((j: any) => j.conclusion === 'failure') || jobsData.jobs?.[0];
        if (!job) return "No jobs found in run.";
        
        const logsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/jobs/${job.id}/logs`;
        const logsRes = await fetchWithAuth(logsUrl, githubToken);
        return await logsRes.text();
    } catch (e: any) {
        return `Failed to fetch logs: ${e.message}`;
    }
}

// Helper: Ask LLM to modify the workflow file to run ONLY on the temp branch and ONLY the specific test
async function generateWorkflowOverride(config: AppConfig, workflowContent: string, branchName: string, errorSummary: string): Promise<string> {
    const prompt = `
      You are a GitHub Actions Specialist.
      I need to modify an existing workflow file for a TEMPORARY SANDBOX TEST.
      
      GOALS:
      1. Trigger: Ensure the workflow runs on 'push' to branch '${branchName}'.
      2. Scope: Attempt to modify the test command to run ONLY the failing test related to: "${errorSummary}".
         - If it's Pytest, change 'pytest' to 'pytest path/to/failed_test.py'.
         - If it's Jest, add '-t "test name"'.
         - If unsure about the specific test, keep the general test command but ensure it runs on the branch.
      3. CRITICAL: The 'on:' section MUST explicitly include:
         on:
           push:
             branches: ['${branchName}']
      
      ORIGINAL WORKFLOW:
      ${workflowContent}
      
      Return ONLY the valid YAML content. No markdown code blocks.
    `;

    try {
        const response = await unifiedGenerate(config, {
             contents: prompt,
             config: { maxOutputTokens: 8192 },
             model: MODEL_FAST
        });
        
        let cleanYaml = response.text || "";
        cleanYaml = cleanYaml.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
        return cleanYaml;
    } catch (e) {
        console.warn("Workflow override generation failed, using original.", e);
        return workflowContent;
    }
}

export async function pushMultipleFilesToGitHub(
    config: AppConfig, 
    files: { path: string, content: string }[], 
    baseSha: string,
    targetBranch?: string 
): Promise<string> {
    const { repoUrl, githubToken } = config;

    // determine branch name to fetch latest SHA
    let branchName = targetBranch;
    if (!branchName) {
         const runId = config.selectedRuns[0].id;
         const runInfoUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}`;
         const runInfoRes = await fetchWithAuth(runInfoUrl, githubToken);
         const runInfoData = await runInfoRes.json();
         branchName = runInfoData.head_branch;
    }

    // 0. FETCH LATEST SHA FOR THE BRANCH to avoid non-fast-forward updates
    let latestSha = baseSha;
    try {
        const refUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/git/refs/heads/${branchName}`;
        const refRes = await fetchWithAuth(refUrl, githubToken);
        const refData = await refRes.json();
        latestSha = refData.object.sha;
    } catch (e) {
        console.warn("Could not fetch latest SHA, falling back to baseSha", e);
    }

    const commitUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/git/commits/${latestSha}`;
    const commitRes = await fetchWithAuth(commitUrl, githubToken);
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    const treeItems = [];
    for (const file of files) {
        const cleanPath = file.path.replace(/^\/+/, '');
        const blobUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/git/blobs`;
        const blobRes = await fetchWithAuth(blobUrl, githubToken, {
            method: 'POST',
            body: JSON.stringify({
                content: file.content,
                encoding: 'utf-8'
            })
        });
        const blobData = await blobRes.json();
        treeItems.push({
            path: cleanPath,
            mode: '100644', 
            type: 'blob',
            sha: blobData.sha
        });
    }

    const treeUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/git/trees`;
    const treeRes = await fetchWithAuth(treeUrl, githubToken, {
        method: 'POST',
        body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeItems
        })
    });
    const treeData = await treeRes.json();
    const newTreeSha = treeData.sha;

    const newCommitUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/git/commits`;
    const newCommitRes = await fetchWithAuth(newCommitUrl, githubToken, {
        method: 'POST',
        body: JSON.stringify({
            message: `fix: auto-remediation for ${files.length} file(s) by Recursive Agent`,
            tree: newTreeSha,
            parents: [latestSha] // Parent must be the latest SHA
        })
    });
    const newCommitData = await newCommitRes.json();
    const newCommitSha = newCommitData.sha;

    const refUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/git/refs/heads/${branchName}`;
    await fetchWithAuth(refUrl, githubToken, {
        method: 'PATCH',
        body: JSON.stringify({
            sha: newCommitSha,
            force: false
        })
    });

    return newCommitData.html_url;
}

async function waitForWorkflowConclusion(
    config: AppConfig, 
    branchName: string, 
    pushTime: Date,
    logCallback: (msg: string) => void
): Promise<{ conclusion: string, html_url: string, id: number }> {
    const { repoUrl, githubToken } = config;
    const maxMinutes = config.sandboxTimeoutMinutes || 5;
    const intervalMs = 15000; 
    const startTime = Date.now();
    
    logCallback(`Polling GitHub Actions for new run on branch '${branchName}'... (Timeout: ${maxMinutes}m)`);

    while (Date.now() - startTime < maxMinutes * 60 * 1000) {
        const runsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs?branch=${branchName}&per_page=1`;
        const res = await fetchWithAuth(runsUrl, githubToken);
        const data = await res.json();
        
        if (data.workflow_runs && data.workflow_runs.length > 0) {
            const run = data.workflow_runs[0];
            const runDate = new Date(run.created_at);
            
            if (runDate >= pushTime) {
                logCallback(`Run identified: #${run.id} (${run.status})...`);
                
                if (run.status === 'completed') {
                    return { conclusion: run.conclusion, html_url: run.html_url, id: run.id };
                }
            }
        }
        
        await new Promise(r => setTimeout(r, intervalMs));
    }
    
    throw new Error("Sandbox Timeout: Workflow did not complete in time.");
}

// --- LLM Providers ---

async function generateZAI(config: AppConfig, params: any): Promise<{ text: string }> {
    const apiKey = config.customApiKey || process.env.API_KEY; 
    const baseUrl = (config.llmBaseUrl || 'https://api.z.ai/api/coding/paas/v4').replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    const model = config.llmModel || 'GLM-4.6';

    const messages = [];
    
    if (params.config?.systemInstruction) {
        messages.push({ role: 'system', content: params.config.systemInstruction });
    }
    
    let userContent = "";
    if (typeof params.contents === 'string') {
        userContent = params.contents;
    } else if (params.contents?.parts) {
        userContent = params.contents.parts.map((p: any) => p.text).join('\n');
    } else if (params.contents) {
        userContent = JSON.stringify(params.contents);
    }
    messages.push({ role: 'user', content: userContent });

    const body: any = {
        model: model,
        messages: messages,
    };

    if (params.config?.responseMimeType === 'application/json') {
        body.response_format = { type: "json_object" };
    }
    
    if (params.config?.maxOutputTokens) {
        body.max_tokens = params.config.maxOutputTokens;
    } else {
        body.max_tokens = 8192; 
    }

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Z.AI API Error ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        return { text: data.choices?.[0]?.message?.content || "" };
    } catch (e: any) {
        throw new Error(`Z.AI Provider Failed: ${e.message}`);
    }
}

function getGeminiClient(config: AppConfig) {
    // FIX: Prefer custom API key if available, else fallback to env
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
        const isRateLimit = 
            e.status === 429 || 
            e.code === 429 || 
            msg.includes('429') || 
            msg.includes('quota') || 
            msg.includes('RESOURCE_EXHAUSTED');

        if (isRateLimit && retries > 0) {
            const jitter = Math.random() * 500;
            const waitTime = baseDelay + jitter;
            console.warn(`Gemini API 429 (Rate Limit). Retrying in ${Math.round(waitTime)}ms... (Attempts left: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return callGeminiWithRetry(fn, retries - 1, baseDelay * 2);
        }
        throw e;
    }
}

async function generateWithFallback(
    ai: GoogleGenAI, 
    config: AppConfig,
    params: any
): Promise<GenerateContentResponse> {
    // Allow model override from params (e.g. for Pro model requests)
    const userModel = params.model || config.llmModel || MODEL_FAST;
    
    const candidates = [userModel];
    // Only add fallbacks if we are using the default config model, not a specific override
    if (!params.model) {
        candidates.push('gemini-2.0-flash');
        candidates.push('gemini-flash-latest');
    }
    const uniqueCandidates = [...new Set(candidates)];

    let lastError: any = null;

    for (const model of uniqueCandidates) {
        try {
             return await callGeminiWithRetry(() => ai.models.generateContent({
                model: model,
                ...params
            }));
        } catch (e: any) {
            lastError = e;
            const msg = (e.message || "") + JSON.stringify(e); 
            
            const isNotFound = 
                e.status === 404 || 
                e.code === 404 || 
                msg.includes('404') || 
                msg.includes('Requested entity was not found') ||
                msg.includes('NOT_FOUND');
            
            if (isNotFound) {
                console.warn(`Model '${model}' failed (404/NotFound). Attempting fallback...`);
                continue; 
            }
            throw e;
        }
    }
    console.error("All model candidates failed.");
    throw lastError;
}

export async function unifiedGenerate(config: AppConfig, params: any): Promise<{ text: string }> {
    if (config.llmProvider === 'zai' || config.llmProvider === 'openai') {
        return generateZAI(config, params);
    }
    
    const ai = getGeminiClient(config);
    const resp = await generateWithFallback(ai, config, params);
    return { text: resp.text || "" };
}

function safeJsonParse<T>(text: string, fallback: T): T {
    if (!text) return fallback;

    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch {
            }
        }
        try {
            const clean = text
                .replace(/```json/g, '')
                .replace(/```/g, '')
                .trim();
            if (clean.startsWith('{') && clean.endsWith('}')) {
                return JSON.parse(clean);
            }
        } catch {
            console.warn("Failed to parse JSON response:", text.substring(0, 200) + "...");
        }
    }
    return fallback;
}

function normalizeDiagnosis(data: any): { summary: string, filePath: string } {
    const summary = data.summary || data.answer || data.result || data.analysis || data.issue || "Unknown Error (Keys Missing)";
    const filePath = data.filePath || data.file || data.path || data.filepath || "";
    return { summary, filePath };
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

export async function generateRepoSummary(config: AppConfig): Promise<string> {
    // Tool: Scan directory
    const rootFiles = await listRepoDirectory(config, '');
    
    // Tool: Read Dependency Manifests (NEW)
    const dependencyReport = await toolScanDependencies(config);

    const priorityFiles = ['README.md', 'README.txt', 'agents.md', 'CONTRIBUTING.md'];
    
    let contextDocs = `Root Directory Structure:\n${rootFiles.map(f => `- ${f.name} (${f.type})`).join('\n')}\n\n`;
    contextDocs += `Dependency Analysis:\n${dependencyReport}\n\n`;

    for (const fileName of priorityFiles) {
        const found = rootFiles.find(f => f.name.toLowerCase() === fileName.toLowerCase());
        if (found && found.type === 'file') {
            try {
                const fileData = await getFileContent(config, found.path);
                const content = fileData.content.length > 5000 
                    ? fileData.content.substring(0, 5000) + "\n...(truncated)" 
                    : fileData.content;
                contextDocs += `--- START ${fileName} ---\n${content}\n--- END ${fileName} ---\n\n`;
            } catch (e) {
                console.warn(`Failed to read context file ${fileName}`, e);
            }
        }
    }

    const prompt = `
        You are a Repository Analysis Agent. 
        Review the file structure, dependency manifests, and documentation provided below.
        
        Create a concise summary (max 300 words) for an autonomous DevOps agent that needs to fix code in this repo.
        Include:
        1. Tech Stack (Languages, Frameworks detected in dependencies)
        2. Key Architecture/Structure patterns
        3. Special Instructions from 'agents.md' or 'CONTRIBUTING.md' if present.
        
        Repository Context:
        ${contextDocs}
    `;

    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { maxOutputTokens: 1024 },
            model: MODEL_FAST
        });
        return response.text || "No summary generated.";
    } catch (e: any) {
        console.error("Repo Summarizer Failed", e);
        return "Repository Summary unavailable due to API error.";
    }
}

export async function generatePostMortem(config: AppConfig, failedAgents: AgentState[]): Promise<string> {
    const failedSummary = failedAgents.map(a => 
        `- Agent ${a.name}: Status=${a.status}. Last known phase=${a.phase}.`
    ).join('\n');

    // Tool: Web Search for solutions (NEW)
    let externalKnowledge = "";
    if (config.llmProvider === 'gemini' || config.tavilyApiKey) {
        try {
            // Pick the first significant error to search for
            // In a real scenario, we might loop all agents, but to save tokens/API calls we pick one representative error
            const query = `Fix error in ${failedAgents[0].name}: ${failedAgents[0].message || "Unknown error"}`;
            externalKnowledge = await toolWebSearch(config, query);
        } catch (e) {
            console.warn("Post-mortem search failed", e);
        }
    }

    const prompt = `
        You are a Senior DevOps Architect. 
        Some automated repair agents failed to fix the build pipeline after multiple attempts.
        
        Analyze the situation and provide a concise set of manual recommendations for the human developer.
        
        Failed Agents:
        ${failedSummary}

        External Knowledge (Web Search):
        ${externalKnowledge}
        
        Output format:
        1. Brief Summary of what likely went wrong (1-2 sentences).
        2. Bullet points of specific things the user should check manually (e.g. "Check secret keys in GitHub Secrets", "Verify external API availability").
        
        Keep it encouraging but technical.
    `;

    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { maxOutputTokens: 512 },
            model: MODEL_FAST
        });
        return response.text || "Manual intervention required. Please check logs.";
    } catch {
        return "System Alert: Post-mortem generation failed. Please review logs manually.";
    }
}

export async function diagnoseError(config: AppConfig, logSnippet: string, repoContext?: string): Promise<{ summary: string, filePath: string }> {
  const MAX_LOG_LENGTH = 100000;
  const truncatedLog = logSnippet.length > MAX_LOG_LENGTH 
    ? logSnippet.substring(logSnippet.length - MAX_LOG_LENGTH) 
    : logSnippet;

  const prompt = `
    Analyze this CI/CD build log. Identify the primary error and the source code file causing it.
    
    ${repoContext ? `REPOSITORY CONTEXT (Use this to understand file structure): \n${repoContext}\n` : ''}

    Constraints:
    1. Output strictly valid JSON. No markdown formatting. No conversational text.
    2. SUMMARY should be actionable and explain WHAT is wrong (e.g. "Missing dependency 'jwt' in requirements.txt").
    3. FILEPATH must be relative to repo root. 
       - If "ModuleNotFoundError" or "ImportError": Return the dependency file (e.g. requirements.txt, package.json, go.mod, setup.py).
       - If "Permission denied", "Command not found", or "Timeout": Return the workflow file (.github/workflows/...).
       - Do NOT start with /.
    4. IMPORTANT: You MUST provide a filePath. If you are unsure, provide the most likely configuration file (e.g. main.py, package.json, .github/workflows/main.yml) that controls the failing process.
    
    Log Snippet (Last ${MAX_LOG_LENGTH} chars):
    ${truncatedLog}
  `;

  try {
      const response = await unifiedGenerate(config, {
        contents: prompt,
        config: {
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              filePath: { type: Type.STRING }
            }
          }
        },
        model: MODEL_FAST
      });
      
      const text = response.text || "{}";
      const parsedRaw = safeJsonParse(text, { summary: "", filePath: "" });
      
      const parsed = normalizeDiagnosis(parsedRaw);

      if (!parsed.summary || parsed.summary.includes("Unknown Error")) {
          parsed.summary = `Parse Error. Raw Output: ${text.substring(0, 150)}...`;
      }
      if (!parsed.filePath) parsed.filePath = ""; 

      return parsed;
  } catch (e: any) {
      if (e.message?.includes('429') || e.message?.includes('quota')) {
          throw new Error("API Quota Exceeded (429). Please try again later.");
      }
      console.error("Diagnosis Error:", e.message);
      return { summary: `Diagnosis Failed: ${e.message}`, filePath: "" };
  }
}

export async function generateDetailedPlan(config: AppConfig, errorSummary: string, feedback: string, repoContext: string): Promise<AgentPlan> {
    const prompt = `
      You are a Lead DevOps Strategist. The previous attempt to fix a CI/CD error failed.
      Create a detailed, step-by-step plan to resolve the issue.

      Error: "${errorSummary}"
      Previous Feedback: "${feedback}"
      
      Constraint: Create a Plan with 2-4 distinct tasks.
      
      Return strictly JSON:
      {
          "goal": "string (Main objective)",
          "tasks": [
              { "id": "task-1", "description": "string", "status": "pending" }
          ]
      }
    `;

    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { 
                responseMimeType: "application/json",
                maxOutputTokens: 1024
            },
            model: MODEL_SMART // PRO MODEL for Logic
        });
        const plan = safeJsonParse(response.text || "{}", { goal: "Fix error", tasks: [] as any[], approved: false });
        // Enforce approved false
        plan.approved = false;
        return plan;
    } catch {
        return { goal: "Manual Fix", tasks: [{ id: '1', description: 'Check logs manually', status: 'pending' }], approved: false };
    }
}

export async function judgeDetailedPlan(config: AppConfig, plan: AgentPlan, errorSummary: string): Promise<{ approved: boolean, feedback: string }> {
    const prompt = `
      You are the System Overwatch (Judge).
      Review this proposed fix plan for Error: "${errorSummary}".
      
      Plan:
      Goal: ${plan.goal}
      Tasks:
      ${plan.tasks.map(t => `- ${t.description}`).join('\n')}
      
      Instructions:
      1. Is this plan logical and sufficient?
      2. If YES, approve it.
      3. If NO (e.g. it repeats previous mistakes or is too vague), reject it and explain why.
      
      Return JSON: { "approved": boolean, "feedback": "reasoning" }
    `;

    try {
        const response = await unifiedGenerate(config, {
             contents: prompt,
             config: { responseMimeType: "application/json" },
             model: MODEL_FAST // Judge can be fast usually, logic already in plan
        });
        return safeJsonParse(response.text || "{}", { approved: true, feedback: "Auto-approved due to judge error." });
    } catch {
        return { approved: true, feedback: "Judge Offline. Auto-approving." };
    }
}

export async function generateFix(config: AppConfig, codeFile: CodeFile, errorSummary: string, userFeedback?: string, repoContext?: string, activePlan?: AgentPlan): Promise<string> {
  const prompt = `
    You are an expert Senior DevOps Engineer and Code Repair Agent.
    Your mission is to FIX the code to resolve the error described below.

    ${repoContext ? `PROJECT GUIDELINES & CONTEXT: \n${repoContext}\n` : ''}

    Context:
    - Error: "${errorSummary}"
    - File: ${codeFile.name}
    ${userFeedback ? `- PREVIOUS ATTEMPT FAILED: ${userFeedback} \n    - CRITICAL: You MUST try a different approach than before.` : ''}

    ${activePlan ? `
    --- APPROVED STRATEGIC PLAN ---
    Goal: ${activePlan.goal}
    Execute the following tasks:
    ${activePlan.tasks.map(t => `- ${t.description}`).join('\n')}
    -------------------------------
    ` : ''}

    Instructions:
    1. Analyze the file content and the error.
    2. Apply the necessary changes to fix the bug or add the missing dependency.
    3. You MUST MODIFY the code. Do not return the original code unchanged.
    4. CRITICAL: Return the FULL, COMPLETE updated file content.
    5. DO NOT use lazy placeholders like "// ... rest of code", "# ...", or "TodoRead()".
    6. CRITICAL: You must output the FULL file content from start to finish.
    7. STOPPING EARLY IS A FAILURE. Ensure the last line of your output matches the expected last line of the file logic.
    8. DO NOT summarize. If the file is 500 lines, output 500 lines.
    9. DO NOT use markdown formatting (like \`\`\`python). Just raw text if possible, or wrapped in standard code blocks.
    10. YAML SPECIFIC: Ensure strict indentation (2 spaces) and valid syntax. Do not leave trailing open lines like 'run: |'.
    
    File Content:
    ${codeFile.content}
  `;

  const response = await unifiedGenerate(config, {
    contents: prompt,
    config: {
        maxOutputTokens: 8192
    },
    model: MODEL_SMART // PRO MODEL for Code Generation
  });
  
  let cleanCode = extractCode(response.text || "", codeFile.language);
  return cleanCode;
}

export async function judgeFix(config: AppConfig, original: string, modified: string, errorSummary: string, repoContext?: string): Promise<{ passed: boolean, reasoning: string, score: number }> {
    if (original.trim() === modified.trim()) {
        return { passed: false, reasoning: "No changes were made to the code. The agent returned the original file.", score: 0 };
    }

    // Tool: Run Syntax Checker (NEW)
    // The Judge checks for basic syntax validity before asking the LLM.
    const lintResult = await toolLintCheck(config, modified, "unknown");

    const prompt = `
      You are a Senior QA Engineer.
      Review this code fix.
      Error to fix: "${errorSummary}"
      
      ${repoContext ? `Context: ${repoContext.substring(0, 500)}...` : ''}

      Linter Status: ${lintResult.valid ? "PASSED" : `FAILED (${lintResult.error})`}
      
      Original Code Snippet (Partial):
      ${original.substring(0, 1000)}...
      
      Modified Code Snippet (Partial):
      ${modified.substring(0, 1000)}...
      
      Task:
      1. Determine if the fix logically addresses the error.
      2. Assign a correctness score (0-10).
         - 10: Perfect fix.
         - 8-9: Logically correct but maybe minor style/syntax nits.
         - 5-7: Partial fix, addressed some parts but missed others or introduced new small issues.
         - 0-4: Completely wrong, hallucinated, or introduces critical bugs.
      3. If Linter Status is FAILED, you MUST deduct points significantly (max score 5).
      
      Return JSON: { "passed": boolean, "score": number, "reasoning": "string" }
    `;

    // Enable Google Search for Judge if available to verify library methods
    const useSearch = config.llmProvider === 'gemini' && config.searchProvider === 'gemini_grounding';
    
    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { 
                // If using search tool, we cannot enforce JSON mime type directly, so we relax it
                responseMimeType: useSearch ? undefined : "application/json",
                responseSchema: useSearch ? undefined : {
                    type: Type.OBJECT,
                    properties: {
                        passed: { type: Type.BOOLEAN },
                        score: { type: Type.INTEGER },
                        reasoning: { type: Type.STRING }
                    }
                },
                tools: useSearch ? [{googleSearch: {}}] : undefined,
                maxOutputTokens: 1024
            },
            model: MODEL_SMART // Judge needs good reasoning
        });
        
        return safeJsonParse(response.text || "{}", { passed: false, reasoning: "Empty or Malformed Response", score: 0 });
    } catch {
        return { passed: true, reasoning: "Judge Automated Bypass (API Error)", score: 10 };
    }
}

export async function consolidateFixes(config: AppConfig, originalContent: string, fixes: string[]): Promise<string> {
    if (fixes.length === 1) return fixes[0];

    const prompt = `
      I have multiple agents who tried to fix the same file for different reasons.
      Please merge their changes into a single valid file.
      
      Original:
      ${originalContent}
      
      Fix 1:
      ${fixes[0]}
      
      Fix 2 (if any):
      ${fixes[1] || "N/A"}
      
      Return merged raw code only.
    `;

    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { maxOutputTokens: 8192 },
            model: MODEL_FAST // Merging is usually mechanical
        });

        let cleanCode = response.text || "";
        cleanCode = cleanCode.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
        return cleanCode;
    } catch {
        return fixes[0];
    }
}

export async function getAgentChatResponse(config: AppConfig, message: string): Promise<string> {
    const prompt = `You are a sci-fi DevOps Agent. User: "${message}". Respond briefly.`;
    try {
        const response = await unifiedGenerate(config, { contents: prompt, model: MODEL_FAST });
        return response.text || "Acknowledged.";
    } catch {
        return "System Warning: Uplink unstable (Rate Limit/Error).";
    }
}

export async function runSandboxTest(
    config: AppConfig, 
    group: RunGroup, 
    iteration: number, 
    hasFix: boolean,
    fileChange: FileChange | undefined,
    errorSummary: string,
    logCallback: (msg: string) => void = () => {}
): Promise<{ passed: boolean, logs: string }> {
    
    if (!hasFix || !fileChange) {
         return {
            passed: false,
            logs: `[SANDBOX] Booting environment for ${group.name}...\n[WARN] No fix patch generated by agent.\n[FAIL] Verification aborted: No code to test.`
        };
    }

    if (config.sandboxMode === 'github_actions' && config.githubToken) {
         const branchName = `agent/verify-${group.id}-${Date.now()}`; 
         try {
             logCallback("[SANDBOX] Initializing Real Cloud Verification via GitHub Actions...");
             
             const baseSha = config.selectedRuns[0].head_sha;
             logCallback(`[SANDBOX] Creating temporary branch '${branchName}'...`);
             await createBranch(config, baseSha, branchName);
             
             // --- MODIFICATION: Prepare Workflow Override ---
             logCallback(`[SANDBOX] Fetching original workflow file '${group.mainRun.path}'...`);
             
             let workflowContentToUse = "";
             // CRITICAL FIX: If the agent fixed the workflow file itself, use the FIXED version, not the original!
             if (fileChange.path === group.mainRun.path) {
                 workflowContentToUse = fileChange.modified.content;
                 logCallback(`[SANDBOX] Detected fix is for the workflow itself. Using modified content for override generation.`);
             } else {
                 const workflowFile = await getFileContent(config, group.mainRun.path, baseSha);
                 workflowContentToUse = workflowFile.content;
             }

             logCallback(`[SANDBOX] Configuring workflow isolation for '${errorSummary}'...`);
             const modifiedWorkflow = await generateWorkflowOverride(config, workflowContentToUse, branchName, errorSummary);

             // Prepare file list to push
             let filesToPush = [];

             // 1. If the fix is NOT the workflow file, add the fix to the push list
             if (fileChange.path !== group.mainRun.path) {
                 filesToPush.push({ path: fileChange.path, content: fileChange.modified.content });
             }

             // 2. Add the modified workflow (which now acts as both the runner and potentially the fix if matched)
             // Even if fileChange.path IS the workflow, we push the OVERRIDDEN version to the branch
             // so it triggers correctly.
             filesToPush.push({ path: group.mainRun.path, content: modifiedWorkflow });

             logCallback(`[SANDBOX] Pushing ${filesToPush.length} file(s) to '${branchName}'...`);
             await pushMultipleFilesToGitHub(
                 config,
                 filesToPush,
                 baseSha,
                 branchName
             );
             
             const pushTime = new Date();
             
             logCallback("[SANDBOX] Fix committed. Waiting for GitHub Actions runner to pick up job...");
             const result = await waitForWorkflowConclusion(config, branchName, pushTime, logCallback);
             
             // --- FETCH LOGS FROM REMOTE ---
             logCallback(`[SANDBOX] Run finished. Retrieving execution logs...`);
             const executionLogs = await getRunLogs(config, result.id);
             
             // --- CLEANUP RUN (DELETE ACTION FROM HISTORY) ---
             logCallback(`[SANDBOX] Cleanup: Deleting workflow run #${result.id} from GitHub history...`);
             await deleteWorkflowRun(config, result.id);
             
             if (result.conclusion === 'success') {
                 return {
                     passed: true,
                     logs: `[SANDBOX] GitHub Actions Verification PASSED.\n[INFO] Remote logs retrieved and run deleted from history.\n\n--- REMOTE LOGS ---\n${executionLogs.substring(0, 5000)}...`
                 };
             } else {
                 // --- MENTAL WALKTHROUGH (Pro) ---
                 logCallback(`[SANDBOX] Analyzing failure cause (Mental Walkthrough)...`);
                 try {
                     const analysis = await unifiedGenerate(config, {
                         contents: `Compare these new logs to the original error: "${errorSummary}". Did the error message change? If yes, we made progress. If no, why did the fix fail? Logs:\n${executionLogs.substring(0, 4000)}`,
                         model: MODEL_SMART
                     });
                     return {
                        passed: false,
                        logs: `[SANDBOX] GitHub Actions Verification FAILED.\n\n--- MENTAL WALKTHROUGH ---\n${analysis.text}\n\n--- REMOTE LOGS ---\n${executionLogs.substring(0, 5000)}...`
                     };
                 } catch {
                     return {
                         passed: false,
                         logs: `[SANDBOX] GitHub Actions Verification FAILED.\n[INFO] Remote logs retrieved and run deleted from history.\n\n--- REMOTE LOGS ---\n${executionLogs.substring(0, 5000)}...`
                     };
                 }
             }
             
         } catch (e: any) {
             return {
                 passed: false,
                 logs: `[SANDBOX] Cloud Execution Error: ${e.message}`
             };
         } finally {
             logCallback(`[SANDBOX] Cleanup: Deleting temporary branch '${branchName}'...`);
             await deleteBranch(config, branchName);
         }
    }
    
    if (config.githubToken || config.customApiKey) {
         const prompt = `
            You are a Strict CI/CD Test Runner Simulator.
            
            SCENARIO:
            A developer attempted to fix the following error: "${errorSummary}"
            File: ${fileChange.path}
            
            ORIGINAL CODE (Snippet):
            ${fileChange.original.content.substring(0, 1000)}...
            
            MODIFIED CODE (Snippet):
            ${fileChange.modified.content.substring(0, 1000)}...
            
            TASK:
            Simulate running the unit/integration tests for this module.
            Does the modification logically fix the error without introducing syntax errors?
            
            OUTPUT:
            Return strictly JSON: { "passed": boolean, "logs": "string" }
            
            LOG RULES:
            - If passed: Generate realistic logs like "Collecting tests...", "Running test_suite...", "PASS".
            - If failed: Generate realistic logs ending in "FAIL" and a plausible traceback related to the code.
            - BE STRICT. If the code looks truncated, has syntax errors, or doesn't address the root cause, FAIL it.
         `;
         
         try {
             const response = await unifiedGenerate(config, {
                 contents: prompt,
                 config: { 
                     responseMimeType: "application/json",
                     responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            passed: { type: Type.BOOLEAN },
                            logs: { type: Type.STRING }
                        }
                     },
                     maxOutputTokens: 2048 
                 },
                 model: MODEL_FAST
             });
             const result = safeJsonParse(response.text || "{}", { passed: false, logs: "Sandbox Error: Failed to parse simulation result." });
             
             let finalLogs = `[SANDBOX] Booting Virtual Simulator for ${group.name}...\n[SANDBOX] Applying patch...\n${result.logs}`;

             // --- MENTAL WALKTHROUGH (Simulation) ---
             if (!result.passed) {
                 logCallback(`[SANDBOX] Simulation failed. Analyzing cause (Mental Walkthrough)...`);
                 try {
                     const analysis = await unifiedGenerate(config, {
                         contents: `Compare these simulated logs to the original error: "${errorSummary}". 
Did the error message change? If yes, explain what changed and what the new error implies.
If no, why did the fix fail?
Simulated Logs:
${result.logs.substring(0, 4000)}`,
                         model: MODEL_SMART
                     });
                     finalLogs += `\n\n--- MENTAL WALKTHROUGH ---\n${analysis.text}`;
                 } catch (e) {
                     console.warn("Mental Walkthrough failed", e);
                 }
             }

             return {
                 passed: result.passed,
                 logs: finalLogs
             };
         } catch (e: any) {
             return {
                 passed: false,
                 logs: `[SANDBOX] Simulation Error: ${e.message}`
             };
         }
    }

    if (iteration === 0) {
        return {
            passed: false,
            logs: `[SANDBOX] Booting environment for ${group.name}...\n[SANDBOX] Applying patch...\n[SANDBOX] Running tests...\n[FAIL] Tests failed with exit code 1.\n[FAIL] regression_test.py::test_edge_case failed.`
        };
    }
    
    return {
        passed: true,
        logs: `[SANDBOX] Booting environment for ${group.name}...\n[SANDBOX] Applying patch...\n[SANDBOX] Running tests...\n[PASS] All tests passed (45/45).`
    };
}


// --- INDEPENDENT AGENT LOOP ---
// This function runs entirely independently for each RunGroup
export const runIndependentAgentLoop = async (
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    updateStateCallback: (id: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], msg: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> => {
    const MAX_RETRIES = 3;
    let iteration = 0;
    let previousFeedback: string | undefined = undefined;
    let dependencyContext = "";
    
    // Log Wrapper
    const log = (level: LogLine['level'], msg: string, id: string = group.id, name: string = group.name) => logCallback(level, msg, id, name);
    const judgeLog = (msg: string) => logCallback('WARN', `[JUDGE] ${msg}`, 'JUDGE', 'Judge');

    // Initialize State with empty file registry
    const initialState: AgentState = { 
        groupId: group.id, 
        name: group.name, 
        phase: AgentPhase.UNDERSTAND, 
        iteration: 0, 
        status: 'working',
        files: {} 
    };
    updateStateCallback(group.id, initialState);
    
    let currentState = initialState; // Local tracker for return value
    let persistentFileContent: CodeFile | null = null; // Store partial fixes

    while (iteration < MAX_RETRIES) {
        try {
            // 1. UNDERSTAND
            currentState = { ...currentState, phase: AgentPhase.UNDERSTAND, iteration, status: 'working' };
            updateStateCallback(group.id, currentState);
            log('INFO', iteration === 0 ? `Agent Activated. Analyzing Run #${group.mainRun.id}...` : `Retry #${iteration}. Re-analyzing failure...`);
            
            const { logText, headSha } = await getWorkflowLogs(config.repoUrl, group.mainRun.id, config.githubToken);

            // --- TOOL: SCAN DEPENDENCIES (If import error suspected) ---
            const isDependencyIssue = logText.includes("ModuleNotFoundError") || 
                                      logText.includes("ImportError") || 
                                      logText.includes("No module named") ||
                                      logText.includes("Missing dependency") ||
                                      logText.includes("package") ||
                                      logText.includes("Cannot find module");
                                      
            if (isDependencyIssue) {
                 currentState = { ...currentState, phase: AgentPhase.TOOL_USE };
                 updateStateCallback(group.id, currentState);
                 log('TOOL', 'Invoking Dependency Inspector (toolScanDependencies)...');
                 const depReport = await toolScanDependencies(config, headSha);
                 dependencyContext = `\nDEPENDENCY REPORT:\n${depReport}\n`;
                 log('INFO', 'Dependency Scan complete.');
            }

            // Diagnose
            const diagnosis = await diagnoseError(config, logText, initialRepoContext + dependencyContext);
            
            let cleanPath = diagnosis.filePath ? diagnosis.filePath.replace(/^\/+/, '') : '';
            
            // --- TOOL: CODE SEARCH (If path ambiguous) ---
            if (!cleanPath || cleanPath === 'unknown' || cleanPath === '') {
                 currentState = { ...currentState, phase: AgentPhase.TOOL_USE };
                 updateStateCallback(group.id, currentState);
                 log('TOOL', `Invoking Code Search for error keywords...`);
                 const searchResults = await toolCodeSearch(config, diagnosis.summary.substring(0, 30));
                 if (searchResults.length > 0) {
                     cleanPath = searchResults[0];
                     log('INFO', `Search found potential match: ${cleanPath}`);
                 }
            }

            if (!cleanPath) cleanPath = 'README.md'; // Safety fallback
            log('DEBUG', `Diagnosis: ${diagnosis.summary} in ${cleanPath}`);

            // --- PLANNING & APPROVAL (Iteration > 0) ---
            // If this is a retry, we engage the Judge Planning Loop
            let approvedPlan: AgentPlan | undefined = undefined;
            
            if (iteration > 0) {
                 currentState = { ...currentState, phase: AgentPhase.PLAN };
                 updateStateCallback(group.id, currentState);
                 log('WARN', `Failure Detected in previous run. Initiating Strategic Planning Subroutine...`);
                 
                 let planApproved = false;
                 let planAttempts = 0;
                 let planFeedback = previousFeedback || "Previous fix failed. Create a better plan.";

                 while (!planApproved && planAttempts < 3) {
                     // Generate Plan
                     log('INFO', `Drafting Fix Strategy (Attempt ${planAttempts + 1})...`);
                     const plan = await generateDetailedPlan(config, diagnosis.summary, planFeedback, initialRepoContext);
                     currentState = { ...currentState, currentPlan: plan, phase: AgentPhase.PLAN_APPROVAL };
                     updateStateCallback(group.id, currentState);
                     
                     // Judge Plan
                     judgeLog(`Reviewing Agent Strategy: "${plan.goal}"...`);
                     const judgement = await judgeDetailedPlan(config, plan, diagnosis.summary);
                     
                     if (judgement.approved) {
                         planApproved = true;
                         plan.approved = true;
                         approvedPlan = plan;
                         judgeLog(`Plan Approved. Proceed with execution.`);
                         log('SUCCESS', `Strategy locked. Executing ${plan.tasks.length} tasks...`);
                         
                         currentState = { ...currentState, currentPlan: plan };
                         updateStateCallback(group.id, currentState);
                     } else {
                         judgeLog(`Plan Rejected: ${judgement.feedback}`);
                         planFeedback = judgement.feedback;
                         planAttempts++;
                         log('WARN', 'Plan rejected by Overwatch. Revising strategy...');
                     }
                 }
                 
                 if (!approvedPlan) {
                     log('ERROR', 'Unable to formulate approved plan. Aborting agent.');
                     return { ...currentState, status: 'failed', phase: AgentPhase.FAILURE };
                 }
            }

            // 2. IMPLEMENT
            currentState = { ...currentState, phase: AgentPhase.IMPLEMENT, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            // Fetch file content - either from REPO or from PREVIOUS ITERATION (if close)
            let currentContent: CodeFile;
            if (persistentFileContent && persistentFileContent.name === cleanPath.split('/').pop()) {
                currentContent = persistentFileContent;
                log('INFO', 'Continuing implementation from previous partial fix...');
            } else {
                currentContent = await findClosestFile(config, cleanPath, headSha);
            }

            // --- TOOL: WEB SEARCH (If obscure error) ---
            let externalKnowledge = "";
            if (iteration > 0 || diagnosis.summary.includes("exit code") || diagnosis.summary.includes("unknown")) {
                const providerLabel = config.searchProvider === 'tavily' ? 'Tavily AI' : 'Google Search';
                log('TOOL', `Invoking Web Search (${providerLabel}) for solution...`);
                const searchRes = await toolWebSearch(config, diagnosis.summary);
                externalKnowledge = `\nExternal Search Results: ${searchRes}\n`;
                log('INFO', 'External knowledge retrieved.');
            }

            // Execute Implementation (Injecting Plan if available)
            let fixedContentStr = await generateFix(
                config, 
                currentContent, 
                diagnosis.summary + externalKnowledge + dependencyContext, 
                previousFeedback, 
                initialRepoContext,
                approvedPlan
            );
            
            // --- SANITY CHECK: Output Validation ---
            const isSuspicious = fixedContentStr.length < 50 || 
                                 fixedContentStr.includes("TodoRead") || 
                                 (currentContent.content.length > 200 && fixedContentStr.length < currentContent.content.length * 0.4);
            
            if (isSuspicious) {
                 log('WARN', 'Agent generated suspiciously short or lazy code. Rejecting output and retrying generation...');
                 fixedContentStr = await generateFix(
                     config, 
                     currentContent, 
                     diagnosis.summary + " CRITICAL: PREVIOUS OUTPUT WAS TRUNCATED. YOU MUST OUTPUT THE ENTIRE FILE.", 
                     "Previous output was rejected because it contained placeholders like 'TodoRead' or was incomplete.", 
                     initialRepoContext
                 );
            }

            // --- PRE-CHECK: Identity Check ---
            if (normalizeCode(currentContent.content) === normalizeCode(fixedContentStr)) {
                 log('WARN', 'Pre-check: No changes detected. Retrying generation with strict directive...');
                 fixedContentStr = await generateFix(
                     config, 
                     currentContent, 
                     diagnosis.summary + " CRITICAL: YOU MUST MODIFY THE CODE. DO NOT RETURN ORIGINAL FILE.", 
                     "Previous output was identical to original file. Please apply changes.", 
                     initialRepoContext
                 );
                 
                 if (normalizeCode(currentContent.content) === normalizeCode(fixedContentStr)) {
                      log('WARN', 'Pre-check failed again: Still no changes. Skipping Judge.');
                      previousFeedback = "Verification Pre-check Failed: You returned the exact original file twice. You must modify the code.";
                      iteration++;
                      continue;
                 }
            }

            // --- TOOL: SYNTAX LINTER (Self-Correction Loop) ---
            log('TOOL', 'Running Syntax Linter (toolLintCheck)...');
            let lintResult = await toolLintCheck(config, fixedContentStr, currentContent.language);
            
            if (!lintResult.valid) {
                log('WARN', `Linter found syntax error: ${lintResult.error}. Agent attempting self-correction...`);
                currentState = { ...currentState, phase: AgentPhase.IMPLEMENT }; 
                updateStateCallback(group.id, currentState);
                
                fixedContentStr = await generateFix(
                    config, 
                    {...currentContent, content: fixedContentStr},
                    `Fix the following SYNTAX ERROR: ${lintResult.error}`,
                    "Previous attempt had syntax errors. Fix them while keeping the rest of the logic.",
                    initialRepoContext
                );
                
                lintResult = await toolLintCheck(config, fixedContentStr, currentContent.language);
                if (lintResult.valid) {
                     log('INFO', 'Self-correction successful. Syntax valid.');
                } else {
                     log('ERROR', 'Self-correction failed. Proceeding with risk of syntax error.');
                }
            } else {
                log('INFO', 'Syntax Check Passed.');
            }

            // 3. VERIFY (Judge)
            currentState = { ...currentState, phase: AgentPhase.VERIFY, status: 'working' };
            updateStateCallback(group.id, currentState);
            const judgeResult = await judgeFix(config, currentContent.content, fixedContentStr, diagnosis.summary, initialRepoContext);

            if (!judgeResult.passed) {
                if (judgeResult.score >= 8) {
                    log('WARN', `Judge Rejected but Score ${judgeResult.score}/10. Keeping partial fix for next iteration.`);
                    persistentFileContent = { ...currentContent, content: fixedContentStr };
                    previousFeedback = `Judge Score ${judgeResult.score}/10. Reasoning: ${judgeResult.reasoning}. KEEP previous changes, but address the remaining issues.`;
                } else {
                    log('WARN', `Judge Rejected (Score ${judgeResult.score}/10). Discarding fix and reverting to original.`);
                    persistentFileContent = null;
                    previousFeedback = `Judge Rejected (Score ${judgeResult.score}/10): ${judgeResult.reasoning}.`;
                }
                
                iteration++;
                continue; 
            }
            
            log('SUCCESS', 'Fix accepted by Judge.');
            
            // Update Agent's PRIVATE File State
            const newFileChange: FileChange = {
                path: cleanPath,
                original: currentContent,
                modified: { ...currentContent, content: fixedContentStr },
                status: 'modified'
            };

            currentState = { ...currentState, files: { [cleanPath]: newFileChange } };
            updateStateCallback(group.id, currentState);

            // 4. SANDBOX TESTING
            currentState = { ...currentState, phase: AgentPhase.TESTING, status: 'waiting' };
            updateStateCallback(group.id, currentState);
            log('INFO', 'Queueing Sandbox Verification...');

            // Run Sandbox using the AGENT'S specific files
            currentState = { ...currentState, phase: AgentPhase.TESTING, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            const testResult = await runSandboxTest(
                config, 
                group, 
                iteration, 
                true, 
                newFileChange, 
                diagnosis.summary,
                (msg) => log('DEBUG', msg)
            );

            const testLines = testResult.logs.split('\n');
            testLines.forEach(l => {
                if (l.includes('[FAIL]')) log('ERROR', l);
                else if (l.includes('[PASS]')) log('SUCCESS', l);
            });

            if (testResult.passed) {
                currentState = { ...currentState, phase: AgentPhase.SUCCESS, status: 'success' };
                updateStateCallback(group.id, currentState);
                log('SUCCESS', 'Agent successfully verified fix.');
                return currentState; 
            } else {
                currentState = { ...currentState, phase: AgentPhase.FAILURE, status: 'failed' };
                updateStateCallback(group.id, currentState);
                log('ERROR', 'Verification Failed.');
                previousFeedback = `Sandbox Verification Failed. Logs: ${testResult.logs.substring(0, 500)}...`;
                iteration++;
            }

        } catch (e: any) {
            log('ERROR', `Agent Exception: ${e.message}`);
            iteration++;
        }
    }

    // If loop finishes without success
    currentState = { ...currentState, phase: AgentPhase.FAILURE, status: 'failed' };
    updateStateCallback(group.id, currentState);
    log('ERROR', 'Agent Mission Failed after max retries.');
    return currentState;
};

// Helper for normalizeCode
function normalizeCode(str: string) {
    return str.trim().replace(/\r\n/g, '\n');
}
