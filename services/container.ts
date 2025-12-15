
import * as GitHub from './github/GitHubService.js';
import * as Sandbox from './sandbox/SandboxService.js';
import * as LLM from './llm/LLMService.js';
import * as Analysis from './analysis/LogAnalysisService.js';

export interface ServiceContainer {
    github: typeof GitHub;
    sandbox: typeof Sandbox;
    llm: typeof LLM;
    analysis: typeof Analysis;
}

export const defaultServices: ServiceContainer = {
    github: GitHub,
    sandbox: Sandbox,
    llm: LLM,
    analysis: Analysis
};
