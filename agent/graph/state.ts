import { AppConfig, RunGroup, LogLine, FileChange, ErrorDAG } from '../../types.js';
import { DiagnosisResult } from '../../services/analysis/LogAnalysisService.js';
import { ClassifiedError } from '../../errorClassification.js';
import { SandboxEnvironment } from '../../sandbox.js';
import { ServiceContainer } from '../../services/container.js';
import { RepositoryProfile } from '../../validation.js';
import { AgentState } from '../../types.js';
import { CIFixerTool } from '../../services/orchestration/tool-types.js';
import { LLMCallMetrics } from '../../services/llm/LLMService.js';

export interface GraphState {
    // Static Context
    config: AppConfig;
    group: RunGroup;
    activeLog: string;

    // Graph Control Flow
    currentNode: string;
    iteration: number;
    maxIterations: number;
    status: 'working' | 'success' | 'failed' | 'stopped';
    failureReason?: string;

    // Data Accumulators
    initialRepoContext: string;
    initialLogText: string;
    currentLogText: string; // The "active" log segment we are looking at

    // Artifacts
    classification?: ClassifiedError;
    diagnosis?: DiagnosisResult;
    plan?: string;

    // Execution State
    files: Record<string, FileChange>;
    fileReservations: string[];

    // History Tracking
    history: Array<{
        node: string;
        action: string;
        result: string;
        timestamp: number;
    }>;

    // Feedback Loop
    feedback: string[];

    // Dependency Tracking
    currentErrorFactId?: string; // Track current error fact for dependency linking

    // Complexity Tracking (AoT - Atom of Thoughts)
    problemComplexity?: number; // Current complexity score
    complexityHistory: number[]; // Complexity over iterations
    refinedProblemStatement?: string; // Distilled problem statement
    isAtomic?: boolean; // Whether problem has converged to atomic state

    // DAG Decomposition (AoT Phase 2)
    errorDAG?: ErrorDAG; // Decomposed problem structure
    solvedNodes: string[]; // IDs of completed nodes
    currentNodeId?: string; // Active node being solved

    // ToolOrchestra Integration
    selectedTools?: CIFixerTool[];      // Tools selected for this iteration
    toolExecutionOrder?: string[];      // Actual execution order
    budgetRemaining?: number;           // Remaining cost budget (USD)
    totalCostAccumulated?: number;      // Total cost so far (USD)
    totalLatencyAccumulated?: number;   // Total latency so far (ms)
    llmMetrics?: LLMCallMetrics[];      // Metrics from all LLM calls
    rewardHistory?: number[];           // Reward scores per iteration
    selectedModel?: string;             // Model selected for this iteration

    // Loop Detection
    loopDetected?: boolean;
    loopGuidance?: string;
}

export interface GraphContext {
    sandbox?: SandboxEnvironment;
    services: ServiceContainer;
    profile?: RepositoryProfile;
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void;
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void;
    dbClient?: any; // Injectable database client for test isolation
}

export type NodeHandler = (state: GraphState, context: GraphContext) => Promise<Partial<GraphState>>;
