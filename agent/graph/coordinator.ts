import { AppConfig, RunGroup, AgentState, AgentPhase, LogLine } from '../../types.js';
import { SandboxEnvironment } from '../../sandbox.js';
import { ServiceContainer } from '../../services/container.js';
import { RepositoryProfile } from '../../validation.js';
import { GraphState, GraphContext, NodeHandler } from './state.js';
import { withSpan, setAttributes, addEvent } from '../../telemetry/tracing.js';

// Node Imports
import { analysisNode } from './nodes/analysis.js';
import { decompositionNode } from './nodes/decomposition.js';
import { planningNode } from './nodes/planning.js';
import { codingNode } from './nodes/execution.js';
import { verificationNode } from './nodes/verification.js';
import { repairAgentNode } from './nodes/repair-agent.js';

const NODE_MAP: Record<string, NodeHandler> = {
    'analysis': analysisNode,
    'decomposition': decompositionNode,
    'planning': planningNode,
    'execution': codingNode,
    'repair-agent': repairAgentNode,  // RepairAgent autonomous mode
    'verification': verificationNode
};

export async function runGraphAgent(
    config: AppConfig,
    group: RunGroup,
    sandbox: SandboxEnvironment | undefined,
    profile: RepositoryProfile | undefined,
    initialRepoContext: string,
    services: ServiceContainer,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {
    return withSpan('graph-agent-execution', async (span) => {
        const startTime = Date.now();

        setAttributes(span, {
            'agent.group_id': group.id,
            'agent.group_name': group.name,
            'agent.max_iterations': 5,
            'agent.has_sandbox': !!sandbox,
            'agent.has_profile': !!profile
        });

        // 1. Initialize Graph State
        let state: GraphState = {
            config,
            group,
            activeLog: "",
            currentNode: 'analysis',
            iteration: 0,
            maxIterations: 5,
            status: 'working',
            initialRepoContext,
            initialLogText: "", // Populated by AnalysisNode
            currentLogText: "",
            files: {},
            fileReservations: [],
            history: [],
            feedback: [],
            complexityHistory: [], // AoT: Track complexity over iterations
            solvedNodes: [] // AoT Phase 2: Track completed DAG nodes
        };

        // Context (Runtime Dependencies)
        const context: GraphContext = {
            sandbox,
            services,
            profile,
            updateStateCallback,
            logCallback: (level, content) => {
                logCallback(level, content, group.id, group.name);
                state.activeLog += `[${level}] ${content}\n`;
                // We batch this update usually, but here we do it live
                updateStateCallback(group.id, { activeLog: state.activeLog });
            }
        };

        const log = context.logCallback;
        log('INFO', '[GraphAgent] Initializing Graph Architecture...');

        // 2. Event Loop
        while (state.status === 'working' && state.iteration < state.maxIterations) {

            const handler = NODE_MAP[state.currentNode];

            if (!handler) {
                if (state.currentNode === 'finish') {
                    state.status = 'success';
                    break;
                }
                log('ERROR', `Unknown node: ${state.currentNode}. Aborting.`);
                state.status = 'failed';
                state.failureReason = `Unknown node: ${state.currentNode}`;
                break;
            }

            try {
                // Update UI Phase
                let phase = AgentPhase.IDLE;
                switch (state.currentNode) {
                    case 'analysis': phase = AgentPhase.UNDERSTAND; break;
                    case 'decomposition': phase = AgentPhase.PLAN; break; // Decomposition is part of planning
                    case 'planning': phase = AgentPhase.PLAN; break;
                    case 'execution': phase = AgentPhase.IMPLEMENT; break;
                    case 'verification': phase = AgentPhase.TESTING; break;
                }
                updateStateCallback(group.id, { phase, iteration: state.iteration });

                // LOGGING FOR DEBUG
                log('VERBOSE', `[Coordinator] Executing ${state.currentNode}. FileReservations: ${JSON.stringify(state.fileReservations)}`);

                // EXECUTE NODE WITH TRACING
                const updates = await withSpan(`node-${state.currentNode}`, async (nodeSpan) => {
                    setAttributes(nodeSpan, {
                        'node.name': state.currentNode,
                        'node.iteration': state.iteration,
                        'node.file_count': Object.keys(state.files).length
                    });

                    const result = await handler(state, context);

                    addEvent(nodeSpan, 'node-completed', {
                        next_node: result.currentNode || state.currentNode
                    });

                    return result;
                });

                // Merge Updates
                state = { ...state, ...updates };

                // Record History
                state.history.push({
                    node: state.currentNode, // Note: this is the node we JUST ran (or the next one? technically previous)
                    action: 'transition',
                    result: 'completed',
                    timestamp: Date.now()
                });

                // Persist Intermediate State
                // Map GraphState back to AgentState (Partial)
                const agentStateUpdate: Partial<AgentState> = {
                    status: state.status as AgentState['status'],
                    files: state.files,
                    fileReservations: state.fileReservations
                };
                updateStateCallback(group.id, agentStateUpdate);

            } catch (e: any) {
                log('ERROR', `Crash in node ${state.currentNode}: ${e.message}`);
                state.status = 'failed';
                state.failureReason = e.message;

                addEvent(span, 'node-error', {
                    node: state.currentNode,
                    error: e.message
                });

                break;
            }
        }

        // AoT: Complexity-aware termination
        if (state.status === 'working') {
            if (state.iteration >= state.maxIterations) {
                state.status = 'failed';
                state.failureReason = 'Max iterations reached.';
            } else if (state.complexityHistory.length > 2) {
                const convergence = services.complexity.detectConvergence(state.complexityHistory);

                // Early success if problem is atomic and stable
                if (state.isAtomic && convergence.isStable) {
                    log('INFO', '[AoT] Problem has converged to atomic state. Ready for final solution.');
                }

                // Warn if diverging (complexity increasing)
                if (convergence.isDiverging) {
                    log('WARN', '[AoT] Complexity is increasing - problem may be getting harder. Consider alternative approach.');
                }

                // Log complexity trend
                if (state.problemComplexity !== undefined) {
                    log('VERBOSE', `[AoT] Final ${services.complexity.explainComplexity(state as any, state.problemComplexity)}`);
                }
            }
        }

        log('INFO', `[GraphAgent] Finished. Status: ${state.status}`);

        // Record metrics
        const duration = (Date.now() - startTime) / 1000;
        
        // Ingest live CI execution data
        try {
            // Ingest Logs
            await services.ingestion.ingestRawData(
                state.activeLog,
                `live-run-${group.id}`,
                'log',
                {
                    groupId: group.id,
                    status: state.status,
                    iterations: state.iteration,
                    duration: duration,
                    errorCategory: state.classification?.category || 'unknown'
                }
            );

            // Ingest Artifacts (Modified Files)
            for (const [path, fileInfo] of Object.entries(state.files)) {
                if (fileInfo.modified?.content) {
                    await services.ingestion.ingestRawData(
                        fileInfo.modified.content,
                        `live-artifact-${group.id}-${path}`,
                        'diff', // Or 'code', but spec mentioned extracting patterns from diffs
                        {
                            groupId: group.id,
                            path: path,
                            iteration: state.iteration
                        }
                    );
                }
            }
        } catch (e) {
            log('WARN', `Failed to ingest live logs: ${e instanceof Error ? e.message : String(e)}`);
        }

        setAttributes(span, {
            'agent.final_status': state.status,
            'agent.iterations': state.iteration,
            'agent.duration_seconds': duration,
            'agent.files_modified': Object.keys(state.files).length
        });

        addEvent(span, 'agent-completed', {
            status: state.status,
            iterations: state.iteration
        });

        // Record fix attempt metrics
        services.metrics.recordFixAttempt(
            state.status === 'success',
            duration,
            state.iteration,
            state.classification?.category || 'unknown'
        );

        // Record learning metrics for the dashboard
        try {
            await services.learningMetrics.recordMetric(
                'Fix Rate',
                state.status === 'success' ? 1.0 : 0.0,
                {
                    groupId: group.id,
                    category: state.classification?.category || 'unknown',
                    iterations: state.iteration
                }
            );
        } catch {
            // Ignore metric recording errors
        }

        // Return Final AgentState
        // Map GraphState status to AgentState status
        let agentStatus: 'idle' | 'working' | 'waiting' | 'success' | 'failed';
        if (state.status === 'stopped') {
            agentStatus = 'failed';
        } else {
            agentStatus = state.status as 'working' | 'success' | 'failed';
        }

        return {
            groupId: group.id,
            name: group.name,
            phase: state.status === 'success' ? AgentPhase.SUCCESS : AgentPhase.FAILURE,
            iteration: state.iteration,
            status: agentStatus,
            files: state.files,
            fileReservations: state.fileReservations,
            activeLog: state.activeLog,
            message: state.failureReason
        };
    }, {
        attributes: {
            'component': 'graph-coordinator'
        }
    });
}
