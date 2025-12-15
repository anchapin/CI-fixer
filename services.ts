export * from './services/llm/LLMService.js';
export * from './services/github/GitHubService.js';
export * from './services/sandbox/SandboxService.js';
export * from './services/analysis/LogAnalysisService.js';

import { AppConfig, CodeFile } from './types.js';

// Legacy shim for searchRepoFile (if needed, but it was just returning null)
export async function searchRepoFile(config: AppConfig, query: string): Promise<string | null> {
    return null;
}
