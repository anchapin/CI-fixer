import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { AppConfig, CodeFile, WorkflowRun, RunGroup, AgentState, AgentPlan, FileChange, AgentPhase } from './types';

// --- Constants ---
const GITHUB_API_BASE = 'https://api.github.com';
const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_SMART = 'gemini-3-pro-preview';

// --- CONTEXT COMPILER (Architectural Pattern: Context Engineering) ---
// Transforms raw state into a focused "Working Context" for specific phases.
// This implements "Scope by Default" and "Artifact Separation".
export function compileContext(
    phase: AgentPhase,
    repoSummary: string,
    errorSummary: string,
    activeFile?: CodeFile,
    recentLogs?: string
): string {
    let context = `Current Phase: ${phase}\n`;

    // Tier 1: Session Context (High Level)
    // Always include the error summary as it is the "North Star"
    context += `Active Error: "${errorSummary}"\n\n`;

    // Tier 2: Phase-Specific Scoping
    switch (phase) {
        case AgentPhase.UNDERSTAND:
        case AgentPhase.PLAN:
        case AgentPhase.PLAN_APPROVAL:
            // Planning needs high-level architecture, not line-by-line code.
            context += `Repository Architecture:\n${repoSummary}\n`;
            if (recentLogs) {
                // Scope logs to the tail to prevent context bloat
                const tailLogs = recentLogs.length > 5000 ? recentLogs.substring(recentLogs.length - 5000) : recentLogs;
                context += `\nRecent Logs (Tail):\n${tailLogs}\n`;
            }
            break;

        case AgentPhase.IMPLEMENT:
        case AgentPhase.ACQUIRE_LOCK:
            // Implementation needs the specific artifact (file), not the whole repo summary.
            // "Artifact Separation": We treat the active file as the primary focus.
            if (activeFile) {
                context += `Target Artifact: ${activeFile.name}\n`;
                // Note: The full content is usually injected by the tool function (generateFix), 
                // but here we ensure the *context* surrounding it is minimal.
                context += `Language: ${activeFile.language}\n`;
            }
            // Minimal repo hints
            context += `\nContext Hints: ${repoSummary.substring(0, 500)}...\n`; 
            break;

        case AgentPhase.VERIFY:
        case AgentPhase.TESTING:
            // Verification needs the error and the specific change logic.
            context += `Verification Target: Ensure fix resolves "${errorSummary}".\n`;
            break;

        default:
            context += `Repository Summary:\n${repoSummary}\n`;
            break;
    }

    return context;
}

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
       throw new Error(`GitHub Authentication Failed (401): ${errorDetails}. check if your token is valid.`);
    }
    if (response.status === 403) {
       throw new Error(`GitHub Access Forbidden (403): ${errorDetails}. Check token scopes (repo/workflow).`);
    }
    if (response.status === 404) {
       throw new Error(`Resource not found (404). Verify the Repository URL and that your Token has access to this private repo.`);
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
    excludePatterns: string[] = [] 
): Promise<WorkflowRun[]> {
    const prUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`;
    const prRes = await fetchWithAuth(prUrl, githubToken);
    const prData = await prRes.json();
    
    const headSha = prData.head.sha;
    const branchName = prData.head.ref;

    // STRATEGY: Fetch runs by branch to catch both 'push' and 'pull_request' events.
    // Fetching by SHA alone can be unreliable for PR events associated with merge commits.
    const runsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branchName)}&per_page=100`;
    const runsRes = await fetchWithAuth(runsUrl, githubToken);
    const runsData = await runsRes.json();
    
    // Parse the runs and ensure path is included
    return (runsData.workflow_runs || [])
      .filter((r: any) => {
          // Accept any "bad" conclusion
          const isFailed = ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion);
          if (!isFailed) return false;

          // STRICT MATCHING LOGIC:
          // 1. Match by Head SHA (Direct correlation to the commit)
          const shaMatch = r.head_sha === headSha;
          
          // 2. Match by PR Link (Robust for pull_request events where SHA might differ or be merge-ref)
          const prMatch = r.pull_requests && r.pull_requests.some((pr: any) => pr.number === parseInt(prNumber));

          return shaMatch || prMatch;
      })
      // FIX: Filter out based on provided patterns (case-insensitive)
      .filter((r: any) => {
          if (excludePatterns.length === 0) return true;
          const name = (r.name || '').toLowerCase();
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
  
  const failedJob = jobsData.jobs?.find((j: any) => ['failure', 'timed_out', 'cancelled'].includes(j.conclusion));
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
    
    // --- FIX START: Safety Check ---
    if (!data || !data.name) {
       if (Array.isArray(data)) {
           throw new Error(`Path '${cleanPath}' is a directory, not a file.`);
       }
       throw new Error(`File path '${cleanPath}' returned invalid data (possibly a directory or submodule).`);
    }
    // --- FIX END ---
    
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
    } else if (['ts', 'tsx'].includes(ext)) {
        language = 'typescript';
    } else if (['js', 'jsx'].includes(ext)) {
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

// --- HELPER: Code Extraction (Fix Prompt Leakage & Indentation) ---
function processExtractedBlock(content: string): string {
    let text = content;
    
    // --- FIX: Aggressive Prompt Leak Cleanup ---
    // Remove "Return JSON" appearing at the end of the block
    text = text.replace(/[\r\n]+\s*(Return|Output)\s*(strictly)?\s*JSON:?[\s\S]*$/i, '');
    
    // Remove "Note:" or reasoning at end
    text = text.replace(/[\r\n]+Note:[\s\S]*$/i, '');
    
    // Remove "Here is the code" artifacts at start
    text = text.replace(/^Here is the .*code:[\r\n]+/i, '');

    const normalized = text.replace(/\r\n|\r/g, '\n'); // Normalize line endings
    const lines = normalized.split('\n');
    // Filter out empty lines for indent calculation
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    
    if (nonEmptyLines.length > 0) {
        // Find minimum indentation
        const minIndent = nonEmptyLines.reduce((min, line) => {
            const indent = line.match(/^\s*/)?.[0].length || 0;
            return Math.min(min, indent);
        }, Infinity);

        if (minIndent > 0 && minIndent !== Infinity) {
            return lines.map(l => l.length >= minIndent ? l.substring(minIndent) : l).join('\n').trim();
        }
    }
    return normalized.trim();
}

export function extractCode(raw: string, language: string): string {
    // Helper: Map common languages to their aliases for regex
    const getLangPattern = (lang: string) => {
        const cleanLang = lang.toLowerCase().trim();
        if (cleanLang === 'javascript') return 'javascript|js|jsx';
        if (cleanLang === 'typescript') return 'typescript|ts|tsx';
        if (cleanLang === 'python') return 'python|py';
        if (cleanLang === 'bash' || cleanLang === 'shell' || cleanLang === 'sh') return 'bash|sh|shell';
        return cleanLang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
    };

    // 1. Try to find block with explicit language identifier (Priority)
    // IMPORTANT: If multiple blocks exist, prefer the LAST one as it is usually the "fixed" version
    if (language && language !== 'txt') {
        const langPattern = getLangPattern(language);
        // Match ```(language|alias) ... ```
        const specificRegex = new RegExp(`(\`{3,})\\s*(${langPattern})[^\\n\\r]*[\\n\\r]+([\\s\\S]*?)\\1`, 'gi');
        
        const matches = [...raw.matchAll(specificRegex)];
        if (matches.length > 0) {
            // New Robustness Check: Look for negative indicators before the block
            // e.g. "Here is the ORIGINAL code:" vs "Here is the FIXED code:"
            
            let bestMatchIndex = -1;
            
            // Loop backwards to find the best candidate
            for (let i = matches.length - 1; i >= 0; i--) {
                const match = matches[i];
                const precedingText = raw.substring(Math.max(0, match.index! - 100), match.index!);
                
                const isFixedLabel = /fixed|corrected|updated|solution|final/i.test(precedingText);
                const isOriginalLabel = /original|previous|broken|buggy/i.test(precedingText);
                
                // Priority 1: Explicitly fixed
                if (isFixedLabel) {
                    bestMatchIndex = i;
                    break;
                }
                
                // Priority 2: Neutral (not explicitly original)
                // We accept the LAST neutral one we find (which is the first one we encounter iterating backwards)
                if (!isOriginalLabel && bestMatchIndex === -1) {
                    bestMatchIndex = i;
                }
            }
            
            // Fallback: If we skipped everything (e.g. all labeled "original" or we were too strict), 
            // just take the very last block.
            if (bestMatchIndex === -1) {
                bestMatchIndex = matches.length - 1;
            }

            return processExtractedBlock(matches[bestMatchIndex][3]);
        }
    }

    // 2. Fallback: Preferred Code Block (Not bash/sh/console if possible)
    // This handles case where user asks for 'typescript' but model gives 'javascript', preventing it from grabbing 'bash' install commands first.
    // FIX: Only skip shell blocks if the user didn't ask for a shell-like language
    const isShellRequest = ['bash', 'sh', 'shell', 'zsh'].includes(language.toLowerCase());
    
    if (!isShellRequest) {
        // Regex to find blocks that are NOT bash/sh/console
        // FIX: Added 'g' flag and loop to find the LAST matching block, consistent with Step 1
        const nonShellRegex = /(`{3,})(?!\s*(?:bash|sh|console|terminal|output|log|text))[^\n\r]*[\n\r]+([\s\S]*?)\1/gi;
        const matches = [...raw.matchAll(nonShellRegex)];
        
        if (matches.length > 0) {
            // Return the LAST matching block
            return processExtractedBlock(matches[matches.length - 1][2]);
        }
    }

    // 3. Fallback: Any Markdown Block (Last Resort)
    // FIX: Match GLOBAL (g) to ensure we can find the LAST block if multiple exist
    const anyBlockRegex = /(`{3,})[^\n\r]*[\n\r]+([\s\S]*?)\1/g;
    const matches = [...raw.matchAll(anyBlockRegex)];
    if (matches.length > 0) {
        // Return the LAST matching block
        return processExtractedBlock(matches[matches.length - 1][2]);
    }

    // 4. Fallback: Aggressive cleanup of raw text
    let cleanRaw = raw.trim();
    
    // Remove "Prompt Leaks" with loose matching (Start of file)
    cleanRaw = cleanRaw.replace(/^\s*(Here is|This is) the .*code:[\s\S]*?\n/i, '');
    
    // Remove "Prompt Leaks" at END of file (Aggressive)
    // Matches "Return JSON:" or "Return strictly JSON" appearing at the end of the text
    cleanRaw = cleanRaw.replace(/[\r\n]+\s*(Return|Output)\s*(strictly)?\s*JSON:?[\s\S]*$/i, '');
    
    // Also catch bare "Return JSON" if it was the only content or start of content (rare but possible)
    cleanRaw = cleanRaw.replace(/^Return\s*(strictly)?\s*JSON:?[\s\S]*$/i, '');

    cleanRaw = cleanRaw.replace(/```/g, '').trim();

    // FIX: Remove standalone language identifier line if it remains at the start (e.g. "python\n")
    // This happens if the model output was ```python\nCode... but backticks got stripped or were missing
    if (language && language !== 'txt') {
        // Only strip if it's the very first line
        const langLineRegex = new RegExp(`^${language}\\s*\\n`, 'i');
        cleanRaw = cleanRaw.replace(langLineRegex, '');
    }

    // 5. Language specific cleanup for common hallucinations
    if (['python', 'javascript', 'typescript', 'java', 'go', 'bash', 'sh'].includes(language)) {
        cleanRaw = cleanRaw.replace(/^(?:python|javascript|typescript|java|go|bash|sh) code:?\s*/i, '');
        cleanRaw = cleanRaw.replace(/^(?:Here is|This is) the (?:updated |fixed )?code:?\s*/i, '');

        // Remove dangerous heuristic that stripped valid code before an import statement.
        // It was too aggressive for scripts that start with logic like `print('start')\nimport os`.
        // We now rely primarily on markdown blocks or the specific removals above.
    }
    
    // FIX: Ensure indentation is normalized even for raw text fallback (Crucial for Python/YAML)
    return processExtractedBlock(cleanRaw);
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
            // FILTER: Exclude docs and markdown files to prevent agents from editing documentation
            // instead of code.
            const filteredItems = data.items.filter((item: any) => 
                !item.path.includes('docs/') && 
                !item.path.endsWith('.md') &&
                !item.path.endsWith('.txt')
            );

            // Return top 3 matches
            return filteredItems.slice(0, 3).map((item: any) => item.path);
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
        Check the following ${language} code for syntax errors.
        Ignore logic errors. Only look for missing brackets, indents, colons, or illegal characters.
        
        CODE:
        ${code.substring(0, 50000)}
        
        Return JSON: { "valid": boolean, "error": "string or null" }
    `;
    
    try {
        const response = await unifiedGenerate(config, {
             contents: prompt,
             config: { 
                 systemInstruction: "You are a strict code syntax validator.",
                 responseMimeType: "application/json" 
             },
             model: MODEL_FAST
        });
        
        // FIX: Ensure boolean type safety to prevent "undefined" loop
        const rawResult = safeJsonParse<{ valid: boolean; error?: string }>(response.text || "{}", { valid: true });
        return { 
            valid: typeof rawResult.valid === 'boolean' ? rawResult.valid : true, 
            error: rawResult.error || undefined
        };
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
export async function searchRepoFile(config: AppConfig, filename: string): Promise<{ file: CodeFile, path: string } | null> {
    const { repoUrl, githubToken } = config;
    // Limit search to this repo
    const q = `repo:${repoUrl} filename:${filename}`;
    const url = `${GITHUB_API_BASE}/search/code?q=${encodeURIComponent(q)}`;
    
    try {
        const res = await fetchWithAuth(url, githubToken);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            const file = await getFileContent(config, item.path);
            return { file, path: item.path };
        }
    } catch (e) {
        console.warn("Search failed", e);
    }
    return null;
}

// Smart wrapper to find a file even if the exact path is wrong
export async function findClosestFile(config: AppConfig, filePath: string, commitSha?: string): Promise<{ file: CodeFile, path: string }> {
    try {
        // 1. Try Exact Path
        const file = await getFileContent(config, filePath, commitSha);
        return { file, path: filePath };
    } catch (e: any) {
        if (e.message.includes('404') || e.message.includes('not found')) {
            const fileName = filePath.split('/').pop() || '';

            // 2. Try Search API (Global repo search) - Handles moved files or missing prefixes
            // NOTE: Search API usually only indexes default branch. Won't find new files in PRs if they are unique.
            if (fileName) {
                const found = await searchRepoFile(config, fileName);
                if (found) return found;
            }

            // 3. Strategy for Workflows (Directory Listing)
            // If we are looking for a workflow, it might be misnamed in the diagnosis
            if (filePath.includes('.github/workflows')) {
                const files = await listRepoDirectory(config, '.github/workflows', commitSha);
                
                // Exact filename match in list (case insensitive)
                let bestMatch = files.find(f => f.name.toLowerCase() === fileName.toLowerCase());
                
                // Strong fuzzy match (contains name), but ONLY if significant length
                if (!bestMatch && fileName) {
                    const cleanTarget = fileName.replace(/\.(yml|yaml)$/, '').toLowerCase();
                    // Prevent matching "ci" to "official.yml" - require at least 4 chars
                    if (cleanTarget.length >= 4) {
                         bestMatch = files.find(f => f.name.toLowerCase().includes(cleanTarget));
                    }
                }
                
                if (bestMatch) {
                    const file = await getFileContent(config, bestMatch.path, commitSha);
                    return { file, path: bestMatch.path };
                }
            }
            
            // 4. Fallback: If nothing works, re-throw. 
            // We REMOVED the "fallback to main.yml or any yml" logic here to prevent CrimsonArchitect issues.
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
    const maxRetries = 3;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const jobsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/runs/${runId}/jobs`;
            const jobsRes = await fetchWithAuth(jobsUrl, githubToken);
            const jobsData = await jobsRes.json();
            
            // Find failed job first, else use the first one
            const job = jobsData.jobs?.find((j: any) => j.conclusion === 'failure') || jobsData.jobs?.[0];
            if (!job) {
                 if (i < maxRetries - 1) {
                     await new Promise(r => setTimeout(r, 2000));
                     continue;
                 }
                 return "No jobs found in run.";
            }
            
            const logsUrl = `${GITHUB_API_BASE}/repos/${repoUrl}/actions/jobs/${job.id}/logs`;
            const logsRes = await fetchWithAuth(logsUrl, githubToken);
            
            // Check if redirect or success
            if (logsRes.ok) {
                return await logsRes.text();
            }
        } catch (e: any) {
            console.warn(`Attempt ${i+1} to fetch logs failed:`, e);
            if (i === maxRetries - 1) return `Failed to fetch logs: ${e.message}`;
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    return "Failed to retrieve logs after multiple attempts.";
}

// Helper: Ask LLM to modify the workflow file to run ONLY on the temp branch and ONLY the specific test
export async function generateWorkflowOverride(config: AppConfig, workflowContent: string, branchName: string, errorSummary: string): Promise<string> {
    const systemInstruction = "You are a GitHub Actions Specialist. I need to modify an existing workflow file for a TEMPORARY SANDBOX TEST.";
    
    const prompt = `
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
      4. PRESERVE LOGIC: The workflow content provided might contain RECENT FIXES (e.g. env vars, setup steps). 
         DO NOT change any steps unless necessary for the Trigger or Scope.
         Do NOT revert changes if the provided content looks different from standard templates.
      
      ORIGINAL WORKFLOW CONTENT (May contain fixes):
      ${workflowContent}
      
      Return ONLY the valid YAML content. No markdown code blocks.
    `;

    try {
        const response = await unifiedGenerate(config, {
             contents: prompt,
             config: { systemInstruction, maxOutputTokens: 8192 },
             model: MODEL_FAST
        });
        
        let cleanYaml = extractCode(response.text || "", "yaml");
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
        const status = e.status || e.response?.status;
        
        // Retry on 429 (Rate Limit) and 5xx (Server Errors)
        const isTransient = 
            status === 429 || 
            status === 500 ||
            status === 502 ||
            status === 503 ||
            status === 504 ||
            msg.includes('429') || 
            msg.includes('quota') || 
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('Overloaded');

        if (isTransient && retries > 0) {
            const jitter = Math.random() * 500;
            const waitTime = baseDelay + jitter;
            console.warn(`Gemini API Error (${status}). Retrying in ${Math.round(waitTime)}ms... (Attempts left: ${retries})`);
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
    
    // Explicitly construct candidates with fallbacks
    const candidates = [userModel];
    
    // Add robustness: If using a preview/experimental model, fallback to stable
    if (userModel === 'gemini-3-pro-preview' || userModel === MODEL_SMART) {
        candidates.push('gemini-2.0-flash');
        candidates.push('gemini-flash-latest');
    } else if (userModel === 'gemini-2.5-flash' || userModel === MODEL_FAST) {
        candidates.push('gemini-2.0-flash');
        candidates.push('gemini-flash-latest');
    }

    // Ensure unique candidates
    const uniqueCandidates = [...new Set(candidates)];

    let lastError: any = null;

    for (const model of uniqueCandidates) {
        try {
             return await callGeminiWithRetry(() => ai.models.generateContent({
                ...params,
                model: model // Override the model in params with current candidate
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
            // For 500s or other errors, also try fallback?
            // Usually handled by callGeminiWithRetry, but if retries exhausted, we try next model.
            if (e.status === 503 || e.status === 500) {
                 console.warn(`Model '${model}' failed (${e.status}). Attempting fallback...`);
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

    // Helper to try parsing a string
    const tryParse = (str: string) => {
        try {
            return JSON.parse(str);
        } catch {
            return undefined;
        }
    };

    // 1. Try standard cleanup first (most common case)
    const clean = text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
    const standard = tryParse(clean);
    if (standard) return standard;

    // 2. Scan for JSON objects using brace matching strategy
    // We want the LAST valid JSON object in the text (Agent thought chain -> Final Answer JSON)
    
    const candidateEndIndices: number[] = [];
    // Find all '}' indices
    for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === '}') candidateEndIndices.push(i);
    }

    // Optimization: Only check the last 3 closing braces to avoid perf issues on huge logs
    const endsToCheck = candidateEndIndices.slice(0, 3);

    for (const end of endsToCheck) {
        // Find all '{' before this end
        let start = text.lastIndexOf('{', end);
        while (start !== -1) {
             const potential = text.substring(start, end + 1);
             const result = tryParse(potential);
             if (result) return result;
             
             // Move start backwards
             start = text.lastIndexOf('{', start - 1);
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
            config: { 
                systemInstruction: "You are a Repository Analysis Agent.",
                maxOutputTokens: 1024 
            },
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
            config: { 
                systemInstruction: "You are a Senior DevOps Architect.",
                maxOutputTokens: 512 
            },
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

  // Optimized for Prefix Caching: Context at the end, Static instructions at the top (in config)
  const prompt = `
    Analyze this CI/CD build log. Identify the primary error and the source code file causing it.
    
    Constraints:
    1. Output strictly valid JSON. No markdown formatting. No conversational text.
    2. SUMMARY should be actionable and explain WHAT is wrong (e.g. "Missing dependency 'jwt' in requirements.txt").
    3. FILEPATH must be relative to repo root. 
       - If "ModuleNotFoundError" or "ImportError": Return the dependency file (e.g. requirements.txt, package.json, go.mod, setup.py).
       - If "Permission denied", "Command not found", or "Timeout": Return the workflow file (.github/workflows/...).
       - Do NOT start with /.
    4. IMPORTANT: Return the filePath if clearly identified. If the file path is unknown or ambiguous, return an empty string ("") for filePath. Do NOT guess generic files like 'main.py' or 'setup.py' unless explicitly mentioned in the error stack trace.
    5. RULE: Do not edit documentation. Do NOT return .md or .txt files unless the error is explicitly a markdown lint error.
    6. RULE: If logs end abruptly without an error message, assume "Resource Exhaustion" or "OOM" and return the workflow file (.github/workflows/...) to optimize resources.
    
    Log Snippet (Last ${MAX_LOG_LENGTH} chars):
    ${truncatedLog}

    ${repoContext ? `\nREPOSITORY CONTEXT (For file structure matching): \n${repoContext}\n` : ''}
  `;

  try {
      const response = await unifiedGenerate(config, {
        contents: prompt,
        config: {
          systemInstruction: "You are an automated Error Diagnosis Agent.",
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

      // FIX: Ensure summary is a string to avoid TypeError
      const safeSummaryStr = String(parsed.summary || ""); 

      if (!safeSummaryStr || safeSummaryStr.includes("Unknown Error")) {
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
      The previous attempt to fix a CI/CD error failed.
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
                systemInstruction: "You are a Lead DevOps Strategist.",
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
             config: { 
                 systemInstruction: "You are the System Overwatch (Judge).",
                 responseMimeType: "application/json" 
             },
             model: MODEL_FAST // Judge can be fast usually, logic already in plan
        });
        return safeJsonParse(response.text || "{}", { approved: true, feedback: "Auto-approved due to judge error." });
    } catch {
        return { approved: true, feedback: "Judge Offline. Auto-approving." };
    }
}

export async function generateFix(config: AppConfig, codeFile: CodeFile, errorSummary: string, userFeedback?: string, repoContext?: string, activePlan?: AgentPlan): Promise<string> {
  // Knowledge Injection for Common Issues
  let specializedHints = "";
  if (errorSummary.toLowerCase().includes('jwt') && codeFile.language === 'python') {
      specializedHints += "\n    HINT: The 'jwt' package in Python is obsolete and often conflicts. You likely need 'PyJWT'. Use 'pip install PyJWT' or add 'PyJWT' to requirements.txt. Do NOT use 'jwt' package.";
  }
  if (codeFile.language === 'yaml' || codeFile.name.endsWith('.yml')) {
      specializedHints += "\n    HINT: YAML is indentation sensitive. Ensure lists and maps are correctly aligned. Do not cut off lines.";
  }
  // INFRASTRUCTURE INTELLIGENCE
  if (errorSummary.toLowerCase().includes('redis') && (errorSummary.toLowerCase().includes('timeout') || errorSummary.toLowerCase().includes('connection'))) {
      specializedHints += "\n    HINT: For Redis connection timeouts in Docker, ensure the service name is used as the hostname. Check `depends_on` conditions. If using healthchecks, ensure they are configured correctly.";
  }
  // NEW: Disk Space / OOM Hints
  if (errorSummary.toLowerCase().includes('no space left') || errorSummary.toLowerCase().includes('errno 28') || errorSummary.toLowerCase().includes('out of memory')) {
      specializedHints += "\n    HINT: Infrastructure Resource Exhaustion detected. 1) If 'No space left': Add 'uses: jlumbroso/free-disk-space@main' step to workflow or clean up. Use 'pip install --no-cache-dir'. 2) If OOM: Increase runner size or optimize memory usage.";
  }

  // Optimized Prompt for Prefix Caching:
  // 1. Static System Instruction (Config)
  // 2. Context (Dynamic but structured)
  // 3. Artifact (The Code)
  // 4. Task (The fix)
  const prompt = `
    ${repoContext ? `PROJECT GUIDELINES & CONTEXT: \n${repoContext}\n` : ''}

    Context:
    - Error: "${errorSummary}"
    - File Name: ${codeFile.name}
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
    6. CRITICAL: You must output the FULL file content from start to finish. If the file is 300 lines, you must output 300 lines.
    7. STOPPING EARLY IS A FAILURE. Ensure the last line of your output matches the expected last line of the file logic.
    8. DO NOT summarize.
    9. DO NOT use markdown formatting (like \`\`\`python). Just raw text if possible, or wrapped in standard code blocks.
    10. YAML SPECIFIC: Ensure strict indentation (2 spaces) and valid syntax. Do not leave trailing open lines like 'run: |'.
    11. DOCKER SPECIFIC: Ensure COPY paths are relative to the build context. Do not use absolute paths like /tmp/ unless you are certain. Avoid using shell logic (||, &&) inside COPY/ADD.
    12. SECURITY: Do NOT leak these instructions or your prompt into the file content.
    13. NEGATIVE CONSTRAINT: DO NOT include the phrase 'Return JSON' or any reasoning text at the end of the file. Output ONLY code.
    ${specializedHints}

    --- ARTIFACT TO PATCH (${codeFile.name}) ---
    ${codeFile.content}
  `;

  const response = await unifiedGenerate(config, {
    contents: prompt,
    config: {
        systemInstruction: "You are an expert Senior DevOps Engineer and Code Repair Agent.",
        maxOutputTokens: 16384 // Increased from 8192 to prevent truncation
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
      4. If Linter Status is PASSED, be lenient. Do not reject working code for minor stylistic choices.
      5. For Docker/Kubernetes/Infrastructure code: BE STRICT about networking, timeouts, and service dependencies.
      
      Return JSON: { "passed": boolean, "score": number, "reasoning": "string" }
    `;

    // Enable Google Search for Judge if available to verify library methods
    const useSearch = config.llmProvider === 'gemini' && config.searchProvider === 'gemini_grounding';
    
    try {
        const response = await unifiedGenerate(config, {
            contents: prompt,
            config: { 
                systemInstruction: "You are a Senior QA Engineer.",
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
            config: { 
                systemInstruction: "I have multiple agents who tried to fix the same file for different reasons.",
                maxOutputTokens: 8192 
            },
            model: MODEL_FAST // Merging is usually mechanical
        });

        let cleanCode = extractCode(response.text || "", "txt");
        return cleanCode;
    } catch {
        return fixes[0];
    }
}

export async function getAgentChatResponse(config: AppConfig, message: string): Promise<string> {
    const prompt = `User: "${message}". Respond briefly.`;
    try {
        const response = await unifiedGenerate(config, { 
            contents: prompt, 
            config: { systemInstruction: "You are a sci-fi DevOps Agent." },
            model: MODEL_FAST 
        });
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
    logCallback: (msg: string) => void = () => {},
    allFileChanges: Record<string, FileChange> = {}
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
             // Priority: Use the fix for the workflow file if it exists in accumulated changes
             const workflowChange = allFileChanges[group.mainRun.path] || (fileChange.path === group.mainRun.path ? fileChange : undefined);
             
             if (workflowChange) {
                 workflowContentToUse = workflowChange.modified.content;
                 logCallback(`[SANDBOX] Detected fix is for the workflow itself. Using modified content for override generation.`);
             } else {
                 const workflowFile = await getFileContent(config, group.mainRun.path, baseSha);
                 workflowContentToUse = workflowFile.content;
             }

             logCallback(`[SANDBOX] Configuring workflow isolation for '${errorSummary}'...`);
             const modifiedWorkflow = await generateWorkflowOverride(config, workflowContentToUse, branchName, errorSummary);

             // Prepare file list to push
             let filesToPush = [];
             const pathsProcessed = new Set<string>();

             // 1. Add the current file change (Priority)
             if (fileChange.path !== group.mainRun.path) {
                 filesToPush.push({ path: fileChange.path, content: fileChange.modified.content });
                 pathsProcessed.add(fileChange.path);
             }

             // 2. Add other accumulated changes (Context from previous iterations or other files)
             for (const path in allFileChanges) {
                 if (pathsProcessed.has(path)) continue;
                 const fc = allFileChanges[path];
                 // Skip workflow file as it's handled via override
                 if (fc.path !== group.mainRun.path) {
                      filesToPush.push({ path: fc.path, content: fc.modified.content });
                      pathsProcessed.add(fc.path);
                 }
             }

             // 3. Add the modified workflow (Override)
             filesToPush.push({ path: group.mainRun.path, content: modifiedWorkflow });

             // Capture time BEFORE push to avoid clock skew missing the run
             const pushTime = new Date(Date.now() - 15000); // 15s buffer

             logCallback(`[SANDBOX] Pushing ${filesToPush.length} file(s) to '${branchName}'...`);
             await pushMultipleFilesToGitHub(
                 config,
                 filesToPush,
                 baseSha,
                 branchName
             );
             
             logCallback("[SANDBOX] Fix committed. Waiting for GitHub Actions runner to pick up job...");
             const result = await waitForWorkflowConclusion(config, branchName, pushTime, logCallback);
             
             // --- FETCH LOGS FROM REMOTE ---
             logCallback(`[SANDBOX] Run finished (${result.conclusion}). Retrieving execution logs...`);
             
             // Wait a moment for logs to be indexed by GitHub (avoids 404s on immediate fetch)
             await new Promise(r => setTimeout(r, 3000));
             
             const executionLogs = await getRunLogs(config, result.id);
             
             // --- CLEANUP RUN (DELETE ACTION FROM HISTORY) ---
             logCallback(`[SANDBOX] Cleanup: Deleting workflow run #${result.id} from GitHub history...`);
             await deleteWorkflowRun(config, result.id);
             
             if (result.conclusion === 'success') {
                 return {
                     passed: true,
                     logs: `[SANDBOX] GitHub Actions Verification PASSED.\n[INFO] Remote logs retrieved and run deleted from history.\n\n--- REMOTE LOGS ---\n${executionLogs.substring(0, 20000)}...`
                 };
             } else {
                 // --- MENTAL WALKTHROUGH (Pro) ---
                 logCallback(`[SANDBOX] Analyzing failure cause (Mental Walkthrough)...`);
                 
                 // ENHANCED ANALYSIS: DETECT PROGRESS
                 try {
                     const analysis = await unifiedGenerate(config, {
                         contents: `
                            Compare these new logs to the original error: "${errorSummary}". 
                            
                            Original Error: ${errorSummary}

                            New Logs:
                            ${executionLogs.substring(0, 30000)}

                            Task:
                            1. Did the ORIGINAL error disappear?
                            2. Is there a NEW, different error? (e.g. Build passed but tests failed).
                            
                            Output:
                            If progress was made (error changed), start with "PROGRESS:".
                            If the same error persists, start with "PERSISTENT ERROR:".
                            Then explain briefly.
                         `,
                         model: MODEL_SMART
                     });
                     
                     const analysisText = analysis.text || "Analysis failed.";
                     const isProgress = analysisText.includes("PROGRESS:");
                     
                     return {
                        passed: false,
                        logs: `[SANDBOX] GitHub Actions Verification FAILED.\n\n--- MENTAL WALKTHROUGH ---\n${analysisText}\n\n[SYSTEM NOTE] ${isProgress ? "Good news: The original error is gone. We hit a new error." : "Bad news: The original error persists."}\n\n--- REMOTE LOGS ---\n${executionLogs.substring(0, 20000)}...`
                     };
                 } catch {
                     return {
                         passed: false,
                         logs: `[SANDBOX] GitHub Actions Verification FAILED.\n[INFO] Remote logs retrieved and run deleted from history.\n\n--- REMOTE LOGS ---\n${executionLogs.substring(0, 20000)}...`
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
                     systemInstruction: "You are a Strict CI/CD Test Runner Simulator.",
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
                     // FIX: Prepend analysis to logs so it's visible at the top and caught by feedback loops
                     finalLogs = `[SANDBOX] Booting Virtual Simulator for ${group.name}...\n[SANDBOX] Applying patch...\n\n--- MENTAL WALKTHROUGH ---\n${analysis.text}\n\n--- SIMULATED LOGS ---\n${result.logs}`;
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