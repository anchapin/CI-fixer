import { GraphState, GraphContext, NodeHandler } from '../state.js';
import { getWorkflowLogs } from '../../../services/github/GitHubService.js';
import { thinLog, smartThinLog } from '../../../services/context-manager.js';
import { toolScanDependencies } from '../../../services/sandbox/SandboxService.js';
import { getCachedRepoContext } from '../../../services/context-compiler.js';
import { generateRepoSummary, diagnoseError, refineProblemStatement } from '../../../services/analysis/LogAnalysisService.js';
import { classifyErrorWithHistory, getErrorPriority } from '../../../errorClassification.js';
import { db as globalDb } from '../../../db/client.js';
import { hasBlockingDependencies, getBlockedErrors } from '../../../services/dependency-tracker.js';
import { clusterError } from '../../../services/error-clustering.js';
import { estimateComplexity, detectConvergence, isAtomic, explainComplexity } from '../../../services/complexity-estimator.js';
import { withSpan, setAttributes, addEvent } from '../../../telemetry/tracing.js';
import { createHash } from 'crypto';
import { LoopStateSnapshot, AgentPhase } from '../../../types.js';
import { CapabilityProbe } from '../../../services/sandbox/CapabilityProbe.js';
import { ProvisioningService } from '../../../services/sandbox/ProvisioningService.js';

export const analysisNode: NodeHandler = async (state, context) => {
    return withSpan('analysis-node', async (span) => {
        const { config, group, iteration } = state;
        const { logCallback, sandbox, profile, dbClient, services } = context;

        // Use injected dbClient or fall back to global db
        const db = dbClient || globalDb;

        const log = (level: string, msg: string) => logCallback(level as any, msg);

        setAttributes(span, {
            'iteration': iteration,
            'has_feedback': state.feedback.length > 0,
            'complexity_history_length': state.complexityHistory?.length || 0
        });

        log('INFO', `[AnalysisNode] Starting verification/analysis phase (Iteration ${iteration + 1})`);

        let currentLogText = state.currentLogText;

        // 0. LOG DISCOVERY (Only on first run or if explicitly requested refresh)
        // In graph flow, we might want to refresh logs if verification failed in a way that suggests we need fresh logs
        // For now, adhere to worker logic: if empty or specific retry condition
        if (!currentLogText || currentLogText.includes("No failed job found")) {
            let strategy: 'standard' | 'extended' | 'any_error' | 'force_latest' = 'standard';
            if (iteration === 0) strategy = 'extended';
            else if (iteration === 1) strategy = 'any_error';
            else if (iteration === 2) strategy = 'force_latest';

            if (iteration > 2 && currentLogText.includes("No failed job found")) {
                return { status: 'failed', failureReason: "No failed job found in workflow after retries." };
            }

            log('INFO', `Fetching logs with strategy: ${strategy}`);
            try {
                const { logText } = await services.github.getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken, strategy);

                // Context Thinning
                currentLogText = await services.context.smartThinLog(logText, 300);
            } catch (e: any) {
                log('ERROR', `Failed to fetch logs: ${e.message}`);
                return { status: 'failed', failureReason: `Failed to fetch logs: ${e.message}` };
            }
        }

        // Dependency Check (First iteration only)
        let dependencyContext = "";
        if (iteration === 0) {
            const isDependencyIssue = currentLogText.includes("ModuleNotFoundError") ||
                currentLogText.includes("ImportError") ||
                currentLogText.includes("No module named") ||
                currentLogText.includes("Missing dependency");

            if (isDependencyIssue) {
                log('TOOL', 'Invoking Dependency Inspector...');
                const headSha = group.mainRun.head_sha || 'HEAD'; // Fallback
                const depReport = await services.sandbox.toolScanDependencies(config, headSha);
                dependencyContext = `\nDEPENDENCY REPORT:\n${depReport}\n`;
            }
        }

        // 1. DIAGNOSIS
        const cachedSha = group.mainRun.head_sha || 'unknown';
        const repoContext = await getCachedRepoContext(config, cachedSha, () => services.analysis.generateRepoSummary(config, sandbox));
        const diagContext = (iteration === 0) ? repoContext + dependencyContext : repoContext;

        // 1. CLASSIFICATION & MULTI-ERROR DETECTION
        // Split logs into potential sub-error chunks if they are very large
        // For now, let's look for multiple distinct error patterns in the same chunk
        const classified = await services.classification.classifyErrorWithHistory(currentLogText, profile);

        // --- LOOP DETECTION START ---
        // Construct snapshot of current state
        const files = state.files || {};
        const filesChanged = Object.keys(files).sort();
        const contentHash = createHash('sha256');
        for (const file of filesChanged) {
            if (files[file]?.modified?.content) {
                contentHash.update(files[file].modified.content);
            }
        }
        const contentChecksum = contentHash.digest('hex');
        
        // Fingerprint combines error category + message (simplified) + filenames
        // We use the classified fingerprint if available, or construct one
        const errorFingerprint = `${classified.category}:${classified.errorMessage}`;

        const snapshot: LoopStateSnapshot = {
            iteration,
            filesChanged,
            contentChecksum,
            errorFingerprint,
            timestamp: Date.now()
        };

        let loopContext = "";
        if (services.loopDetector) {
            const loopResult = services.loopDetector.detectLoop(snapshot);
            services.loopDetector.addState(snapshot); // Record this state

            if (loopResult.detected) {
                const message = `[LoopDetector] LOOP DETECTED! This state matches iteration ${loopResult.duplicateOfIteration}. You are repeating the same fix logic which leads to the same error. You MUST change your strategy.`;
                log('WARN', message);
                loopContext = `\nCRITICAL WARNING: ${message}\n`;
                // Add to feedback so it persists in the loop
                state.feedback.push(message);
            }

            // --- NEW: Path Hallucination Strategy Shift ---
            const totalHallucinations = services.loopDetector.getTotalHallucinations();
            if (totalHallucinations > 0) {
                // We check if the last targeted path (from any tool) triggered a shift
                // The LoopDetector tracks this internally now.
                // We need a way to check if a shift is active.
                
                // For now, let's assume we want to warn the agent if they are hallucinating.
                const lastPath = services.loopDetector.getLastHallucinatedPath();
                if (lastPath && services.loopDetector.shouldTriggerStrategyShift(lastPath)) {
                    const hallMsg = `[LoopDetector] STRATEGY SHIFT REQUIRED! You have repeatedly targeted the non-existent path '${lastPath}'. STOP using file modification tools on this path. Use 'ls' (listDir), 'glob', or 'search' to discover the correct location first.`;
                    log('WARN', hallMsg);
                    loopContext += `\nCRITICAL WARNING: ${hallMsg}\n`;
                    state.feedback.push(hallMsg);
                }
            }
        } else {
            log('WARN', '[AnalysisNode] Loop detector service missing, skipping loop detection');
        }
        // --- LOOP DETECTION END ---

        // TODO: Future enhancement: if classified.cascadingErrors contains things that look like 
        // independent errors, classify them too.

        const classificationForDiagnosis = {
            category: classified.category,
            priority: services.classification.getErrorPriority(classified.category),
            confidence: classified.confidence,
            affectedFiles: classified.affectedFiles,
            suggestedAction: classified.suggestedAction
        };

        log('INFO', `Diagnosing error (Category: ${classified.category})...`);

        // --- NEW: Proactive Provisioning (Phase 4) ---
        if (classified.category === 'infrastructure' && sandbox) {
            log(AgentPhase.ENVIRONMENT_SETUP, '[Infrastructure] Detected missing tool. Attempting provisioning...');
            const probe = new CapabilityProbe(sandbox);
            const provisioning = new ProvisioningService(sandbox);
            
            const required = await probe.getRequiredTools();
            const available = await probe.probe(required);
            
            for (const tool of required) {
                if (!available.get(tool)) {
                    log(AgentPhase.PROVISIONING, `[Provisioning] Installing ${tool}...`);
                    const runtime = (tool === 'python' || tool === 'pip' || tool === 'pytest') ? 'python' : 'node';
                    const success = await provisioning.provision(tool, runtime as any);
                    if (success) {
                        log('SUCCESS', `Successfully provisioned ${tool}`);
                        const binPath = await provisioning.getGlobalBinPath();
                        if (binPath && !sandbox.envOverrides?.['PATH']?.includes(binPath)) {
                            if (!sandbox.envOverrides) sandbox.envOverrides = {};
                            sandbox.envOverrides['PATH'] = `$PATH:${binPath}`;
                        }
                    } else {
                        log('WARN', `Failed to provision ${tool}`);
                    }
                }
            }
        }
        // ---------------------------------------------

        const diagnosis = await context.services.analysis.diagnoseError(
            config, 
            currentLogText + loopContext, // Inject loop context here
            diagContext, 
            profile, 
            classificationForDiagnosis, 
            state.feedback
        );

        // ROBUSTNESS UPGRADE: If diagnosis missed a high-priority structural error detected by classification, 
        // we should override or augment it.
        if (classified.category === 'dependency_conflict' && diagnosis.fixAction !== 'command') {
             log('WARN', '[Robustness] Detected dependency conflict but diagnosis preferred file edit. Augmenting diagnosis.');
             // We don't force override yet, but we ensure the category is preserved in state
        }

        log('INFO', `Diagnosis: ${diagnosis.summary} (Action: ${diagnosis.fixAction})`);

        // --- NEW: Reproduction Command Inference (Phase 3) ---
        if (!diagnosis.reproductionCommand && sandbox) {
            log('INFO', '[Inference] Reproduction command missing. Attempting inference...');
            const repoPath = sandbox.getLocalPath();
            const inferred = await services.reproductionInference.inferCommand(repoPath, config);
            
            if (inferred) {
                log('SUCCESS', `[Inference] Inferred command: ${inferred.command} (Strategy: ${inferred.strategy})`);
                diagnosis.reproductionCommand = inferred.command;
            } else {
                log('WARN', '[Inference] Could not infer reproduction command.');
            }
        }
        // ----------------------------------------------------

        // AoT: Refine problem statement
        let refinedStatement: string | undefined;
        if (state.feedback.length > 0) {
            log('VERBOSE', '[AoT] Refining problem statement from feedback...');
            refinedStatement = await services.analysis.refineProblemStatement(
                config,
                diagnosis,
                state.feedback,
                state.refinedProblemStatement
            );
            log('VERBOSE', `[AoT] Refined: ${refinedStatement}`);
        }

        // AoT: Calculate complexity
        const tempState = {
            ...state,
            classification: classified,
            diagnosis,
            refinedProblemStatement: refinedStatement
        };
        const complexity = services.complexity.estimateComplexity(tempState as any);
        const complexityHistory = [...(state.complexityHistory || []), complexity];
        const convergence = services.complexity.detectConvergence(complexityHistory);
        const isAtomicState = services.complexity.isAtomic(complexity, complexityHistory);

        log('INFO', `[AoT] ${services.complexity.explainComplexity(tempState as any, complexity)}`);
        log('VERBOSE', `[AoT] Convergence: ${convergence.trend}, Atomic: ${isAtomicState}`);

        // History check (Knowledge Graph) - MOVED AFTER diagnosis is created
        if (iteration === 0) {
            try {
                // Find any previous attempts to fix this specific error in this file
                const previousAttempt = await db.errorFact.findFirst({
                    where: {
                        summary: diagnosis.summary,
                        filePath: diagnosis.filePath || '',
                        // We check if we've seen this attempt in THIS run group or recent ones.
                        // Ideally we check per-RunGroup but we want "Restart persistence".
                        // So checking global history for this File Path is decent heuristic.
                    }
                });

                if (previousAttempt) {
                    log('WARN', `[Knowledge Graph] CAUTION: A similar error was diagnosed previously (Run ${previousAttempt.runId}). Be careful not to repeat mistakes.`);
                    // Note: we can't easily push to 'feedback' here because feedback is in 'state' which is immutable input here
                    // But we can return it in the result
                }

                // Record New Fact with enhanced tracking
                const errorFact = await db.errorFact.create({
                    data: {
                        summary: diagnosis.summary,
                        filePath: diagnosis.filePath || '',
                        fixAction: diagnosis.fixAction,
                        runId: group.id,
                        status: 'in_progress',
                        notes: JSON.stringify({
                            initialDiagnosis: diagnosis.summary,
                            classificationCategory: classified.category,
                            confidence: classified.confidence,
                            timestamp: new Date().toISOString(),
                            // AoT metadata
                            complexity,
                            isAtomic: isAtomicState,
                            refinedStatement
                        })
                    }
                });

                // Check for blocking dependencies
                const isBlocked = await services.dependency.hasBlockingDependencies(errorFact.id);
                if (isBlocked) {
                    const blockers = await services.dependency.getBlockedErrors(errorFact.id);
                    const blockerInfo = blockers[0];
                    if (blockerInfo) {
                        log('WARN', `[Dependency] This error is blocked by ${blockerInfo.blockedBy.length || 0} unresolved error(s)`);
                        if (blockerInfo.blockedBy.length > 0) {
                            log('INFO', `[Dependency] Blocked by: ${blockerInfo.blockedBy.map(b => b.summary).join(', ')}`);
                        }
                    }
                    // Return early with blocked status
                    return {
                        currentLogText,
                        classification: classified,
                        diagnosis,
                        problemComplexity: complexity,
                        complexityHistory,
                        refinedProblemStatement: refinedStatement,
                        isAtomic: isAtomicState,
                        status: 'failed',
                        failureReason: 'Error is blocked by unresolved dependencies',
                        currentNode: 'analysis' // Stay in analysis to retry later
                    };
                }

                // Cluster error for cross-run pattern detection
                try {
                    await services.clustering.clusterError(
                        errorFact.id,
                        classified.category,
                        classified.errorMessage,
                        classified.affectedFiles
                    );
                } catch (e) {
                    log('WARN', `[Clustering] Failed to cluster error: ${e}`);
                }

                // Store error fact ID in state for later updates
                return {
                    currentLogText,
                    classification: classified,
                    diagnosis,
                    currentErrorFactId: errorFact.id,
                    problemComplexity: complexity,
                    complexityHistory,
                    refinedProblemStatement: refinedStatement,
                    isAtomic: isAtomicState,
                    currentNode: 'planning'
                };
            } catch (e) {
                log('WARN', `[KB] Failed to query/write facts: ${e}`);
            }
        }

        addEvent(span, 'analysis-completed', {
            classification_category: classified.category,
            complexity,
            is_atomic: isAtomicState
        });

        setAttributes(span, {
            'classification.category': classified.category,
            'diagnosis.action': diagnosis.fixAction,
            'complexity': complexity,
            'is_atomic': isAtomicState,
            'next_node': 'planning'
        });

        return {
            currentLogText, // Update in case we fetched new logs
            classification: classified,
            diagnosis,
            problemComplexity: complexity,
            complexityHistory,
            refinedProblemStatement: refinedStatement,
            isAtomic: isAtomicState,
            currentNode: 'planning' // Transition to next node
        };
    });
};
