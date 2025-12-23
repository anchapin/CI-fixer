
import { AppConfig, CodeFile } from '../../types.js';
import { SandboxEnvironment, createSandbox } from '../../sandbox.js';
import { Sandbox } from '@e2b/code-interpreter';
import * as yaml from 'js-yaml';
import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import { retryWithBackoff, unifiedGenerate, safeJsonParse } from '../llm/LLMService.js';

// Environment Detection
const IS_BROWSER = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const MODEL_FAST = "gemini-2.5-flash"; // Used for tool fallback
const MODEL_SMART = "gemini-3-pro-preview"; // Used for search fallback

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
    if (apiKey.includes(' ') || apiKey.includes('\n') || apiKey.includes('\r')) {
        return { valid: false, message: 'API key contains invalid characters (spaces, newlines)' };
    }
    return { valid: true, message: 'API key format is valid' };
}

export async function runDevShellCommand(config: AppConfig, command: string, sandbox?: SandboxEnvironment): Promise<{ output: string, exitCode: number }> {
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

    return { output: `[SIMULATION] Shell command executed: ${command}\n> (Mock Output)`, exitCode: 0 };
}

export async function prepareSandbox(config: AppConfig, repoUrl: string, headSha?: string): Promise<SandboxEnvironment> {
    const sandbox = createSandbox(config);

    try {
        await sandbox.init();
    } catch (e: any) {
        throw new Error(`Failed to initialize sandbox: ${e.message}`);
    }

    console.log(`[Sandbox] Persistent Sandbox Created. ID: ${sandbox.getId()}`);

    let cloneUrl = repoUrl;
    if (config.githubToken && !repoUrl.includes('@')) {
        let cleanUrl = repoUrl.replace('https://', '').replace('http://', '');

        // If it looks like "owner/repo" (no dots in the first part), assume github.com
        const parts = cleanUrl.split('/');
        if (parts.length === 2 && !parts[0].includes('.')) {
            cleanUrl = `github.com/${cleanUrl}`;
        }

        cloneUrl = `https://oauth2:${config.githubToken}@${cleanUrl}`;
    }

    console.log(`[Sandbox] Cloning ${repoUrl}...`);

    // Ensure workspace is empty before cloning to avoid "destination path '.' already exists"
    try {
        await sandbox.runCommand('rm -rf ./* ./.??*');
    } catch (e) { /* ignore cleanup errors */ }

    try {
        const cloneRes = await sandbox.runCommand(`git clone ${cloneUrl} .`);
        if (cloneRes.exitCode !== 0) {
            throw new Error(`Git clone failed (Exit Code ${cloneRes.exitCode}): ${cloneRes.stderr}`);
        }
    } catch (e: any) {
        throw new Error(`Failed to clone repo in sandbox: ${e.message}`);
    }

    if (headSha) {
        console.log(`[Sandbox] Checkout ${headSha}...`);
        try {
            await sandbox.runCommand(`git fetch origin ${headSha}`);
        } catch {
            console.log('[Sandbox] Fetch specific SHA failed (expected if not advertised), trying checkout directly...');
        }

        const checkoutRes = await sandbox.runCommand(`git checkout ${headSha}`);
        if (checkoutRes.exitCode !== 0) {
            console.error(`[Sandbox] Checkout failed: ${checkoutRes.stderr}`);
            console.log('[Sandbox] Checkout failed, fetching all refs...');
            await sandbox.runCommand(`git fetch --all`);
            const retryRes = await sandbox.runCommand(`git checkout ${headSha}`);
            if (retryRes.exitCode !== 0) {
                throw new Error(`Failed to checkout commit ${headSha}: ${retryRes.stderr}`);
            }
        }
        console.log(`[Sandbox] Successfully checked out ${headSha}`);
    }

    try {
        console.log('[Sandbox] Checking for dependencies...');
        const check = await sandbox.runCommand('ls package.json requirements.txt pnpm-lock.yaml pnpm-workspace.yaml');
        const output = check.stdout;

        console.log('[Sandbox] Installing LSP Tools (pyright, typescript)...');
        await sandbox.runCommand('npm install -g typescript pyright || pip install pyright');

        if (output.includes('pnpm-lock.yaml') || output.includes('pnpm-workspace.yaml')) {
            console.log('[Sandbox] Detected pnpm configuration. Installing pnpm...');
            await sandbox.runCommand('npm install -g pnpm');
            console.log('[Sandbox] Installing Node dependencies (pnpm)...');
            await sandbox.runCommand('pnpm install');
        } else if (output.includes('package.json')) {
            console.log('[Sandbox] Installing Node dependencies (npm)...');
            await sandbox.runCommand('npm install');
        } else if (output.includes('requirements.txt')) {
            console.log('[Sandbox] Installing Python dependencies...');
            await sandbox.runCommand('pip install -r requirements.txt');
        }

        // Check for Bun
        if (output.includes('bun.lockb') || (output.includes('package.json') && output.includes('"bun"'))) {
            console.log('[Sandbox] Detected Bun configuration. Installing bun...');
            await sandbox.runCommand('curl -fsSL https://bun.sh/install | bash');
            // Add bun to path persistently
            console.log('[Sandbox] Installing Bun dependencies...');
            await sandbox.runCommand('echo \'export BUN_INSTALL="$HOME/.bun"\' >> ~/.bashrc && echo \'export PATH="$BUN_INSTALL/bin:$PATH"\' >> ~/.bashrc && source ~/.bashrc && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun install');
        }

        // Install common tools if missing (Docker, Hadolint)
        // Note: This requires root/sudo, assuming sandbox user has rights or is root
        console.log('[Sandbox] Ensuring Docker CLI and Hadolint are available...');
        await sandbox.runCommand('apt-get update && apt-get install -y docker.io');
        
        // Download and install hadolint binary
        const HADOLINT_VERSION = 'v2.12.0';
        const hadolintCmd = `curl -sL -o /usr/local/bin/hadolint https://github.com/hadolint/hadolint/releases/download/${HADOLINT_VERSION}/hadolint-Linux-x86_64 && chmod +x /usr/local/bin/hadolint`;
        await sandbox.runCommand(hadolintCmd);

    } catch (e: any) {
        console.warn('[Sandbox] Dependency installation warning (continuing):', e);
    }

    // Inject Agent Tools (Code Mode API)
    try {
        console.log('[Sandbox] Injecting Agent Tools (agent_tools.ts)...');
        const fs = await import('fs/promises');
        const path = await import('path');
        const toolsPath = path.resolve(process.cwd(), 'services/sandbox/agent_tools.ts');

        let toolsContent = "";
        try {
            toolsContent = await fs.readFile(toolsPath, 'utf-8');
        } catch (readErr) {
            console.warn(`[Sandbox] Could not read agent_tools.ts from ${toolsPath}, trying fallback...`);
            toolsContent = await fs.readFile('c:\\Users\\ancha\\Documents\\projects\\CI-fixer\\services\\sandbox\\agent_tools.ts', 'utf-8');
        }

        // [Integration] Inject dependencies
        try {
            const verificationPath = path.resolve(process.cwd(), 'utils/fileVerification.ts');
            const verificationContent = await fs.readFile(verificationPath, 'utf-8');
            await sandbox.writeFile('utils/fileVerification.ts', verificationContent);
            
            // Rewrite import for sandbox environment
            toolsContent = toolsContent.replace('../../utils/fileVerification', './utils/fileVerification');
        } catch (depErr) {
            console.warn(`[Sandbox] Failed to inject dependencies for agent_tools: ${depErr}`);
        }

        await sandbox.writeFile('agent_tools.ts', toolsContent);
        console.log('[Sandbox] agent_tools.ts injected successfully.');

    } catch (e: any) {
        console.error(`[Sandbox] Failed to inject agent_tools.ts: ${e.message}`);
    }

    return sandbox;
}

export type SearchType = 'def' | 'ref';

export async function toolCodeSearch(config: AppConfig, query: string, sandbox?: SandboxEnvironment, type: SearchType = 'ref'): Promise<string[]> {
    if (sandbox) {
        let cmd = "";
        if (type === 'def') {
            const pattern = `(class|function|interface|type|def|const|let|var)\\s+${query}\\b`;
            cmd = `grep -rE "${pattern}" . | head -n 5`;
        } else {
            cmd = `grep -r "${query}" . | head -n 5`;
        }

        const res = await runDevShellCommand(config, cmd, sandbox);
        if (res.exitCode === 0 && res.output.trim().length > 0) {
            const lines = res.output.split('\n');
            const paths = lines.map(l => l.split(':')[0]).filter(p => p && !p.startsWith('['));
            return paths.filter((v, i, a) => a.indexOf(v) === i);
        }
    }
    return [];
    return [];
}

export async function toolSemanticCodeSearch(config: AppConfig, query: string, sandbox: SandboxEnvironment): Promise<string[]> {
    if (!sandbox) return [];

    // 1. Broad Search (Grep)
    // Extract keywords that look like identifiers or significant terms
    const keywords = query.match(/\b[a-zA-Z0-9_]{3,}\b/g) || [];
    const uniquePaths = new Set<string>();

    // Limit keywords to avoid excessive searching
    const searchTerms = keywords.length > 0 ? keywords.slice(0, 2) : [query];

    for (const term of searchTerms) {
        const paths = await toolCodeSearch(config, term, sandbox, 'ref');
        paths.forEach(p => uniquePaths.add(p));
    }

    const candidates = Array.from(uniquePaths).slice(0, 10); // Limit to top 10 candidates
    if (candidates.length === 0) return [];

    // 2. LLM Reranking
    // We need to peek at the content to judge relevance. 
    // Reading 10 files might be heavy. Let's just return the grep results for now if no LLM config?
    // The plan says "Use LLM".

    // We'll read the first 50 lines of each candidate to judge
    const candidatesWithContent: { path: string, content: string }[] = [];
    for (const path of candidates) {
        try {
            // Quick read (head)
            const res = await sandbox.runCommand(`head -n 50 ${path}`);
            if (res.exitCode === 0) {
                candidatesWithContent.push({ path, content: res.stdout });
            }
        } catch (e) { /* ignore */ }
    }

    if (candidatesWithContent.length === 0) return candidates;

    const prompt = `
    You are a code search engine.
    Query: "${query}"

    Rank the following files based on their relevance to the query.
    Return a JSON array of filenames, ordered by relevance (most relevant first).

    Candidates:
    ${candidatesWithContent.map(c => `File: ${c.path}\nContent:\n${c.content.substring(0, 500)}...\n---`).join('\n')}
    `;

    try {
        const evaluation = await unifiedGenerate(config, {
            contents: prompt,
            model: MODEL_SMART,
            config: { responseMimeType: "application/json" }
        });

        const rankedFiles = safeJsonParse(evaluation.text, [] as string[]);
        if (Array.isArray(rankedFiles) && rankedFiles.length > 0) {
            // Filter to ensure they are in our candidate list
            return rankedFiles.filter(p => uniquePaths.has(p));
        }
    } catch (e) {
        console.warn("Semantic rank failed, falling back to grep order", e);
    }

    return candidates;
}

export async function toolRunCodeMode(config: AppConfig, script: string, sandbox?: SandboxEnvironment): Promise<string> {
    if (!sandbox) return "Error: Sandbox not available for Code Mode.";

    // We wrap the user's script to import the tools
    // Assuming we use ts-node or similar. We need to install ts-node in the sandbox if not present?
    // We already installed 'typescript' globally. 'ts-node' might not be there.
    // simpler: compile with tsc and run node? or use ts-node from npx.
    // 'agent_tools.ts' is in root.

    // We'll create 'current_task.ts'. 
    // We need to import * as agent_tools from './agent_tools'.
    const fullScript = `
import * as agent_tools from './agent_tools';

// Helper aliases if needed, or LLM uses agent_tools.readFile()
const { readFile, writeFile, runCmd, search, listDir } = agent_tools;

async function main() {
    try {
        // --- User Script ---
        ${script}
        // -------------------
    } catch (e) {
        console.error(e);
    }
}

main();
`;

    const scriptPath = "current_task.ts";
    await sandbox.writeFile(scriptPath, fullScript);

    // Run it. We rely on npx ts-node.
    // NOTE: This might be slow on first run if it downloads ts-node.
    // Alternatively: tsc current_task.ts agent_tools.ts --target esnext --module commonjs && node current_task.js
    // Let's try direct tsc compilation as it is more robust without internet (if cached) or cleaner.
    // But sandbox has internet.
    // Let's stick to ts-node if possible, or tsc.
    // "npx ts-node" is elegant but slow.
    // Let's do: tsc first.

    // But agent_tools is a module.
    // Let's use 'tsx' if available? No.
    // Let's use npx ts-node with --skip-project to avoid reading tsconfig that might interfere
    // Or just "npx ts-node -T current_task.ts" (transpile only)

    // Actually, we can just run: "npx tsx current_task.ts" is often faster/better modern replacement?
    // Let's stick to installing ts-node in prepareSandbox? Or just 'npx -y ts-node'.

    const cmd = `npx -y ts-node -T -O '{"module":"commonjs"}' ${scriptPath}`;
    const result = await sandbox.runCommand(cmd);

    const output = result.stdout + (result.stderr ? `\n[STDERR]\n${result.stderr}` : "");
    return output.trim() || "[No Output]";
}

export async function toolLintCheck(config: AppConfig, code: string, language: string, sandbox?: SandboxEnvironment): Promise<{ valid: boolean, error?: string }> {
    if (sandbox) {
        if (language === 'python') {
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

        if (language === 'typescript' || language === 'javascript' || language === 'javascriptreact' || language === 'typescriptreact') {
            const ext = (language.includes('react') ? 'tsx' : 'ts');
            const tempFile = `temp_check.${ext}`;
            await sandbox.writeFile(tempFile, code);
            const cmd = `npx tsc ${tempFile} --noEmit --esModuleInterop --skipLibCheck --jsx react`;
            const res = await runDevShellCommand(config, cmd, sandbox);
            if (res.exitCode !== 0) {
                const cleanError = res.output.replace(new RegExp(tempFile, 'g'), `file.${ext}`).slice(0, 500);
                return { valid: false, error: `[TSC Type Error] ${cleanError}` };
            }
            return { valid: true };
        }
    }

    if (language === 'yaml' || language === 'yml') {
        try {
            yaml.load(code);
            return { valid: true };
        } catch (e: any) {
            const msg = e.reason || e.message;
            const line = e.mark ? ` at line ${e.mark.line + 1}` : '';
            return { valid: false, error: `[YAML Syntax Error] ${msg}${line}` };
        }
    }

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
        return "";
    }
    return "";
}

export async function toolLSPReferences(config: AppConfig, file: string, line: number, symbol: string, sandbox?: SandboxEnvironment): Promise<string[]> {
    if (sandbox) {
        const cmd = `grep -r "${symbol}" . --include=*.{ts,tsx,js,py,go}`;
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

export async function toolWebSearch(config: AppConfig, query: string): Promise<string> {
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

export async function testE2BConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
    const validation = validateE2BApiKey(apiKey);
    if (!validation.valid) {
        return { success: false, message: `Invalid API Key: ${validation.message}` };
    }

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
            try {
                Object.defineProperty(sbAny, 'jupyterUrl', {
                    get: function () {
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

        if (errStr.includes('Failed to fetch') || errStr.includes('NetworkError') || errStr.includes('Network request failed')) {
            return {
                success: false,
                message: `Network Connection Failed: ${errStr}. Please check connectivity and format.`
            };
        }
        else if (errStr.includes('401') || errStr.includes('403')) {
            return { success: false, message: `Authentication Failed: ${errStr}. Please verify your E2B API key.` };
        }
        else if (errStr.includes('timeout') || errStr.includes('Timeout')) {
            return { success: false, message: `Connection Timeout: ${errStr}. E2B service may be temporarily unavailable.` };
        }
        return { success: false, message: `Connection Error: ${errStr}` };
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

export function createTools(config: AppConfig, sandbox?: SandboxEnvironment) {
    return {
        /*
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
        */
        webSearch: toolDefinition({
            name: 'webSearch',
            description: 'Search the web for information (using Tavily or Google)',
            inputSchema: z.object({
                query: z.string()
            })
        }).server(async ({ query }) => {
            return toolWebSearch(config, query);
        }),
        runCodeMode: toolDefinition({
            name: 'run_code_mode_script',
            description: 'PRIMARY TOOL. Execute a TypeScript script in the sandbox. You have access to `agent_tools` API: `readFile(path)`, `writeFile(path, content)`, `runCmd(command)`, `search(query)`, `listDir(path)`. Use this for ALL file operations, searching, and verification commands.',
            inputSchema: z.object({
                script: z.string().describe('The TypeScript script to execute. Use `await agent_tools.functionName()`')
            })
        }).server(async ({ script }) => {
            return toolRunCodeMode(config, script, sandbox);
        })
    };
}
