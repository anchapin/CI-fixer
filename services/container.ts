
/**
 * Client-Safe Service Container
 *
 * This container contains only services that are safe to use in the browser.
 * It MUST NOT import any server-only modules (db/client.js with dotenv, etc.)
 * to prevent Node.js code from being bundled into the frontend.
 *
 * Database-dependent services are available in server-container.ts for server-side use only.
 *
 * Services excluded from client container (require database):
 * - dependency-tracker.ts (imports db)
 * - error-clustering.ts (imports db)
 * - metrics.ts (imports db)
 * - ingestion, learning, learningMetrics, fixPattern
 */

import * as GitHub from './github/GitHubService.js';
import * as Sandbox from './sandbox/SandboxService.js';
import * as LLM from './llm/LLMService.js';
import * as Analysis from './analysis/LogAnalysisService.js';
import * as Context from './context-manager.js';
import * as Classification from '../errorClassification.js';
import * as Complexity from './complexity-estimator.js';
import * as RepairAgent from './repair-agent/orchestrator.js';
import { FileDiscoveryService } from './sandbox/FileDiscoveryService.js';
import { FileVerificationService } from './sandbox/FileVerificationService.js';
import { FileFallbackService } from './sandbox/FileFallbackService.js';
import { EnvironmentService } from './sandbox/EnvironmentService.js';
import { LoopDetector } from './LoopDetector.js';
import { ReproductionInferenceService } from './reproduction-inference.js';
import { DependencySolverService } from './DependencySolverService.js';

export interface ServiceContainer {
    github: typeof GitHub;
    sandbox: typeof Sandbox;
    discovery: FileDiscoveryService;
    verification: FileVerificationService;
    fallback: FileFallbackService;
    environment: EnvironmentService;
    loopDetector: LoopDetector;
    llm: typeof LLM;
    analysis: typeof Analysis;
    context: typeof Context;
    classification: typeof Classification;
    complexity: typeof Complexity;
    repairAgent: typeof RepairAgent;
    reproductionInference: ReproductionInferenceService;
    // Note: Database-dependent services (dependency, clustering, metrics, ingestion, learning, learningMetrics, fixPattern)
    // are only available in server-container.ts for server-side use
}

export const defaultServices: ServiceContainer = {
    github: GitHub,
    sandbox: Sandbox,
    discovery: new FileDiscoveryService(),
    verification: new FileVerificationService(),
    fallback: new FileFallbackService(),
    environment: new EnvironmentService(),
    loopDetector: new LoopDetector(),
    llm: LLM,
    analysis: Analysis,
    context: Context,
    classification: Classification,
    complexity: Complexity,
    repairAgent: RepairAgent,
    reproductionInference: new ReproductionInferenceService()
    // Note: Database-dependent services removed to prevent Node.js modules
    // from being bundled into frontend. Use server-container.ts on server-side.
};

