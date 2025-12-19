
import * as GitHub from './github/GitHubService.js';
import * as Sandbox from './sandbox/SandboxService.js';
import * as LLM from './llm/LLMService.js';
import * as Analysis from './analysis/LogAnalysisService.js';
import * as Context from './context-manager.js';
import * as Classification from '../errorClassification.js';
import * as Dependency from './dependency-tracker.js';
import * as Clustering from './error-clustering.js';
import * as Complexity from './complexity-estimator.js';
import * as RepairAgent from './repair-agent/orchestrator.js';
import * as Metrics from '../telemetry/metrics.js';

export interface ServiceContainer {
    github: typeof GitHub;
    sandbox: typeof Sandbox;
    llm: typeof LLM;
    analysis: typeof Analysis;
    context: typeof Context;
    classification: typeof Classification;
    dependency: typeof Dependency;
    clustering: typeof Clustering;
    complexity: typeof Complexity;
    repairAgent: typeof RepairAgent;
    metrics: typeof Metrics;
}

export const defaultServices: ServiceContainer = {
    github: GitHub,
    sandbox: Sandbox,
    llm: LLM,
    analysis: Analysis,
    context: Context,
    classification: Classification,
    dependency: Dependency,
    clustering: Clustering,
    complexity: Complexity,
    repairAgent: RepairAgent,
    metrics: Metrics
};

