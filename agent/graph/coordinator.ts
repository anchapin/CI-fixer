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

            // Phase 2: Reproduction-First Workflow - Check before transitioning to execution
            if (state.currentNode === 'execution' || state.currentNode === 'repair-agent') {
                // Get adaptive threshold (default to 1 if not available)
                const phase2Threshold = 'adaptiveThresholds' in services
                    ? (services as any).adaptiveThresholds.getCurrentThreshold('phase2-reproduction', 'reproduction')
                    : 1;

                if (!state.diagnosis?.reproductionCommand) {
                    log('ERROR', '[Reproduction-First] Cannot proceed to execution without reproduction command.');
                    log('ERROR', '[Reproduction-First] The agent must identify a reproduction command before attempting fixes.');
                    log('INFO', '[Reproduction-First] Suggestion: Run ReproductionInferenceService to identify the reproduction command.');

                    // Record the reliability event for Phase 2 trigger
                    let telemetryEventId: string | null = null;
                    if ('reliabilityTelemetry' in services) {
                        try {
                            const event = await (services as any).reliabilityTelemetry.recordReproductionRequired(
                                {
                                    agentRunId: group.id,
                                    groupId: group.id,
                                    errorSummary: state.diagnosis?.errorSummary,
                                    reproductionCommand: state.diagnosis?.reproductionCommand
                                },
                                phase2Threshold
                            );
                            // Get the event ID for recovery tracking
                            const recentEvents = await (services as any).reliabilityTelemetry.getRecentEvents('phase2-reproduction', 1);
                            if (recentEvents.length > 0) {
                                telemetryEventId = recentEvents[0].id;
                            }
                        } catch (e) {
                            log('WARN', `Failed to record reliability event: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }

                    // Phase 3 Enhancement: Attempt recovery before halting
                    if (telemetryEventId && 'recoveryStrategy' in services) {
                        try {
                            log('INFO', '[Recovery] Attempting automatic recovery strategies...');
                            const recoveryResult = await (services as any).recoveryStrategy.attemptRecovery(
                                {
                                    agentRunId: group.id,
                                    layer: 'phase2-reproduction',
                                    threshold: phase2Threshold,
                                    reproductionCommand: state.diagnosis?.reproductionCommand,
                                    errorSummary: state.diagnosis?.errorSummary,
                                    repoPath: config.repoUrl, // May need to convert to local path
                                    config: config,
                                    sandbox: sandbox
                                },
                                telemetryEventId
                            );

                            if (recoveryResult && recoveryResult.success) {
                                log('INFO', `[Recovery] Strategy '${recoveryResult.strategy}' succeeded!`);
                                log('INFO', `[Recovery] Recovered value: ${JSON.stringify(recoveryResult.newValue)}`);
                                log('INFO', `[Recovery] Reasoning: ${recoveryResult.reasoning}`);

                                // Apply the recovered reproduction command
                                if (recoveryResult.newValue && typeof recoveryResult.newValue === 'string') {
                                    state.diagnosis.reproductionCommand = recoveryResult.newValue;
                                    log('INFO', `[Recovery] Reproduction command inferred: ${recoveryResult.newValue}`);
                                    // Continue execution instead of failing
                                    continue;
                                }
                            } else {
                                log('WARN', '[Recovery] All recovery strategies failed or unavailable.');
                            }
                        } catch (e) {
                            log('WARN', `[Recovery] Recovery attempt failed: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }

                    // If recovery didn't succeed, halt as before
                    state.status = 'failed';
                    state.failureReason = 'Reproduction command required but missing. Agent attempted to fix without verifying reproducibility.';
                    state.reproductionRequired = true;
                    state.reproductionCommandMissing = true;

                    // Record the failure metrics
                    const duration = (Date.now() - startTime) / 1000;
                    services.metrics.recordFixAttempt(false, duration, state.iteration, 'reproduction-command-missing');

                    break;
                }
                log('VERBOSE', '[Reproduction-First] Reproduction command verified, proceeding to execution.');

                // Phase 1 Enhancement: Record Phase 2 check passed (non-trigger event)
                if ('reliabilityTelemetry' in services) {
                    try {
                        await (services as any).reliabilityTelemetry.recordEvent({
                            layer: 'phase2-reproduction',
                            triggered: false,
                            threshold: phase2Threshold,
                            context: {
                                agentRunId: group.id,
                                groupId: group.id,
                                errorSummary: state.diagnosis?.errorSummary,
                                reproductionCommand: state.diagnosis?.reproductionCommand
                            }
                        });
                    } catch (e) {
                        // Ignore - telemetry failures shouldn't break the agent
                    }
                }
            }

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
                // ...switch phase...
                let phase = AgentPhase.IDLE;
                switch (state.currentNode) {
                    case 'analysis': phase = AgentPhase.UNDERSTAND; break;
                    case 'decomposition': phase = AgentPhase.PLAN; break;
                    case 'planning': phase = AgentPhase.PLAN; break;
                    case 'execution': phase = AgentPhase.IMPLEMENT; break;
                    case 'verification': phase = AgentPhase.TESTING; break;
                }
                updateStateCallback(group.id, { phase, iteration: state.iteration });

                // ...execution...
                const updates = await withSpan(`node-${state.currentNode}`, async (nodeSpan) => {
                    // ...
                    return await handler(state, context);
                });

                // Merge Updates
                state = { ...state, ...updates };
                
                // If node explicitly set status to anything other than working, break early
                if (state.status !== 'working') {
                    break;
                }

                // Record History
                state.history.push({
                    node: state.currentNode,
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
        if (state.status === 'working' && state.iteration >= state.maxIterations) {
            state.status = 'failed';
            state.failureReason = 'Max iterations reached.';
        }

        if (state.complexityHistory.length > 2) {
            const convergence = services.complexity.detectConvergence(state.complexityHistory);

            // Early success if problem is atomic and stable
            if (state.isAtomic && convergence.isStable) {
                log('INFO', '[AoT] Problem has converged to atomic state. Ready for final solution.');
            }

            // Phase 3: Strategy Loop Detection - Enhanced divergence handling
            if (convergence.isDiverging) {
                // Track how many consecutive iterations have been diverging with high complexity
                const currentComplexity = state.problemComplexity || 0;

                // Get adaptive thresholds (default to 15 and 2 if not available)
                const highComplexityThreshold = 'adaptiveThresholds' in services
                    ? (services as any).adaptiveThresholds.getCurrentThreshold('phase3-loop-detection', 'complexity')
                    : 15;
                const divergenceIterationsThreshold = 'adaptiveThresholds' in services
                    ? (services as any).adaptiveThresholds.getCurrentThreshold('phase3-loop-detection', 'iteration')
                    : 2;

                // Count iterations with high complexity that are diverging
                let divergingHighComplexityCount = 0;
                for (let i = Math.max(0, state.complexityHistory.length - 3); i < state.complexityHistory.length; i++) {
                    if (state.complexityHistory[i] > highComplexityThreshold) {
                        divergingHighComplexityCount++;
                    }
                }

                // Check if we have persistent high complexity divergence
                if (currentComplexity > highComplexityThreshold && divergingHighComplexityCount >= divergenceIterationsThreshold) {
                    log('ERROR', '[Strategy Loop] Agent is stuck in a strategy loop with increasing complexity.');
                    log('ERROR', `[Strategy Loop] Complexity: ${currentComplexity} > ${highComplexityThreshold}, diverging for ${divergingHighComplexityCount}+ iterations`);
                    log('INFO', '[Strategy Loop] Suggested actions:');
                    log('INFO', '  1. Break down the problem into smaller sub-problems');
                    log('INFO', '  2. Try a different approach (e.g., file recreation instead of modification)');
                    log('INFO', '  3. Request human guidance for alternative strategies');
                    log('INFO', `[Strategy Loop] Complexity history: [${state.complexityHistory.join(', ')}]`);

                    // Record the reliability event for Phase 3 trigger
                    let telemetryEventId: string | null = null;
                    if ('reliabilityTelemetry' in services) {
                        try {
                            await (services as any).reliabilityTelemetry.recordStrategyLoopDetected(
                                {
                                    agentRunId: group.id,
                                    groupId: group.id,
                                    complexity: currentComplexity,
                                    complexityHistory: state.complexityHistory,
                                    iteration: state.iteration,
                                    divergingCount: divergingHighComplexityCount
                                },
                                highComplexityThreshold // Threshold value used for detection
                            );
                            // Get the event ID for recovery tracking
                            const recentEvents = await (services as any).reliabilityTelemetry.getRecentEvents('phase3-loop-detection', 1);
                            if (recentEvents.length > 0) {
                                telemetryEventId = recentEvents[0].id;
                            }
                        } catch (e) {
                            log('WARN', `Failed to record reliability event: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }

                    // Phase 3 Enhancement: Attempt recovery before halting
                    let recoverySucceeded = false;
                    if (telemetryEventId && 'recoveryStrategy' in services) {
                        try {
                            log('INFO', '[Recovery] Attempting automatic recovery strategies...');
                            const recoveryResult = await (services as any).recoveryStrategy.attemptRecovery(
                                {
                                    agentRunId: group.id,
                                    layer: 'phase3-loop-detection',
                                    threshold: highComplexityThreshold,
                                    complexity: currentComplexity,
                                    complexityHistory: state.complexityHistory,
                                    iteration: state.iteration,
                                    divergingCount: divergingHighComplexityCount,
                                    config: config
                                },
                                telemetryEventId
                            );

                            if (recoveryResult && recoveryResult.success) {
                                log('INFO', `[Recovery] Strategy '${recoveryResult.strategy}' succeeded!`);
                                log('INFO', `[Recovery] Reasoning: ${recoveryResult.reasoning}`);

                                // Apply the recovery guidance
                                if (recoveryResult.newValue && typeof recoveryResult.newValue === 'object') {
                                    const guidance = recoveryResult.newValue as { guidance?: string; suggestedActions?: string[] };
                                    if (guidance.guidance) {
                                        log('INFO', `[Recovery] Guidance: ${guidance.guidance}`);
                                    }
                                    if (guidance.suggestedActions && guidance.suggestedActions.length > 0) {
                                        log('INFO', '[Recovery] Suggested actions:');
                                        for (const action of guidance.suggestedActions) {
                                            log('INFO', `  - ${action}`);
                                        }
                                    }

                                    // Store recovery guidance in state for the next node to use
                                    state.recoveryGuidance = guidance;
                                    recoverySucceeded = true;

                                    // Reset complexity tracking to give the agent a fresh start
                                    state.complexityHistory = [];
                                    log('INFO', '[Recovery] Complexity tracking reset. Agent will continue with new strategy.');
                                }
                            } else {
                                log('WARN', '[Recovery] All recovery strategies failed or unavailable.');
                            }
                        } catch (e) {
                            log('WARN', `[Recovery] Recovery attempt failed: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }

                    // If recovery didn't succeed, halt as before
                    if (!recoverySucceeded) {
                        // Set state to failed with clear context
                        state.status = 'failed';
                        state.failureReason = `Strategy loop detected: Complexity diverging at ${currentComplexity.toFixed(1)} for ${divergingHighComplexityCount}+ iterations. Human intervention recommended.`;
                        state.loopDetected = true;
                        state.loopGuidance = `Complexity trend: [${state.complexityHistory.join(' → ')}]. Consider alternative approach or manual intervention.`;

                        // Record the failure metrics
                        const duration = (Date.now() - startTime) / 1000;
                        services.metrics.recordFixAttempt(false, duration, state.iteration, 'strategy-loop-detected');

                        // Loop will exit due to state.status = 'failed' above
                    }
                } else {
                    log('WARN', '[AoT] Complexity is increasing - problem may be getting harder. Consider alternative approach.');
                }

                // Phase 1 Enhancement: Record Phase 3 check passed (non-trigger event)
                if ('reliabilityTelemetry' in services) {
                    try {
                        await (services as any).reliabilityTelemetry.recordEvent({
                            layer: 'phase3-loop-detection',
                            triggered: false,
                            threshold: highComplexityThreshold,
                            context: {
                                agentRunId: group.id,
                                groupId: group.id,
                                complexity: currentComplexity,
                                complexityHistory: state.complexityHistory,
                                iteration: state.iteration
                            }
                        });
                    } catch (e) {
                        // Ignore - telemetry failures shouldn't break the agent
                    }
                }
            }

            // Log complexity trend
            if (state.problemComplexity !== undefined) {
                log('VERBOSE', `[AoT] Final ${services.complexity.explainComplexity(state as any, state.problemComplexity)}`);
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
        let agentPhase: AgentPhase;

        if (state.status === 'stopped') {
            agentStatus = 'failed';
            agentPhase = AgentPhase.FAILURE;
        } else if (state.status === 'success') {
            agentStatus = 'success';
            agentPhase = AgentPhase.SUCCESS;
        } else {
            agentStatus = 'failed';
            agentPhase = AgentPhase.FAILURE;
        }

        return {
            groupId: group.id,
            name: group.name,
            phase: agentPhase,
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