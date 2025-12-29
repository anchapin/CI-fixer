
/**
 * Server-side Service Container
 *
 * This container includes database-dependent services and should ONLY be imported
 * in server-side code (server.ts, agent worker, etc.). It MUST NOT be imported
 * in frontend code (App.tsx, components/, etc.) to prevent Node.js modules
 * from being bundled into the browser.
 *
 * The problematic import that causes blank screen issues:
 * - db/client.js imports dotenv which calls process.cwd() (Node.js only)
 * - If this is imported by frontend code, Vite bundles it and breaks the app
 */

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
import { DataIngestionService } from './DataIngestionService.js';
import { LearningLoopService } from './LearningLoopService.js';
import { LearningMetricService } from './LearningMetricService.js';
import { FileDiscoveryService } from './sandbox/FileDiscoveryService.js';
import { FileVerificationService } from './sandbox/FileVerificationService.js';
import { FileFallbackService } from './sandbox/FileFallbackService.js';
import { EnvironmentService } from './sandbox/EnvironmentService.js';
import { db } from '../db/client.js'; // SERVER-ONLY: Node.js database client
import { LoopDetector } from './LoopDetector.js';
import { ReproductionInferenceService } from './reproduction-inference.js';
import { FixPatternService } from './FixPatternService.js';
import { DependencySolverService } from './DependencySolverService.js';

export interface ServerServiceContainer {
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
    dependency: typeof Dependency;
    clustering: typeof Clustering;
    complexity: typeof Complexity;
    repairAgent: typeof RepairAgent;
    metrics: typeof Metrics;
    ingestion: DataIngestionService;
    learning: LearningLoopService;
    learningMetrics: LearningMetricService;
    reproductionInference: ReproductionInferenceService;
    fixPattern: FixPatternService;
}

/**
 * Server-side services container with database access.
 *
 * IMPORTANT: This must ONLY be imported in server-side code!
 * Frontend code should use services/container.ts instead.
 */
export const serverServices: ServerServiceContainer = {
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
    dependency: Dependency,
    clustering: Clustering,
    complexity: Complexity,
    repairAgent: RepairAgent,
    metrics: Metrics,
    ingestion: new DataIngestionService(db), // Database required
    learning: new LearningLoopService(db), // Database required
    learningMetrics: new LearningMetricService(db), // Database required
    reproductionInference: new ReproductionInferenceService(),
    fixPattern: new FixPatternService(db as any) // Database required
};
