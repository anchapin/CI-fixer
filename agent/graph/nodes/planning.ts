import { NodeHandler } from '../types.js';
import { extractFileOutline } from '../../../services/analysis/CodeAnalysisService.js';
import { getNextNode, isDAGComplete } from '../../../services/dag-executor.js';
import { ToolOrchestrator } from '../../../services/orchestration/tool-selector.js';
import { AdaptiveModelSelector } from '../../../services/llm/model-selector.js';
import { PreferencesManager } from '../../../services/preferences/repository-preferences.js';
import { withNodeTracing } from './tracing-wrapper.js'; // Retained as it's used below

const planningNodeHandler: NodeHandler = async (state, context) => {
    const { config, diagnosis: initialDiagnosis, classification, errorDAG, solvedNodes } = state;
    let diagnosis = initialDiagnosis;
    const { logCallback, sandbox, services, dbClient } = context;

    const log = (level: string, msg: string) => logCallback(level as any, msg);

    // ToolOrchestra: Initialize orchestration services
    const orchestrator = new ToolOrchestrator();
    const modelSelector = new AdaptiveModelSelector();
    const prefsManager = new PreferencesManager(dbClient);

    // Initialize budget if not set (default: $1.00 per fix attempt)
    const budgetRemaining = state.budgetRemaining ?? 1.0;
    const totalCostAccumulated = state.totalCostAccumulated ?? 0;
    const llmMetrics = state.llmMetrics ?? [];

    // ROBUSTNESS: Ensure high-priority category is handled correctly by orchestrator
    const activeCategory = classification?.category || 'UNKNOWN';

    // ToolOrchestra: Select optimal tools and model
    let selectedTools = state.selectedTools;
    let selectedModel = state.selectedModel;

    if (diagnosis && !selectedTools) {
        // Get learned recommendation
        const recommendation = await services.learning.getStrategyRecommendation(
            activeCategory,
            state.problemComplexity || 5
        );

        const successRate = recommendation.historicalStats?.successRate || 0;
        const confidenceThreshold = 0.5; // Require at least 50% historical success

        if (recommendation.preferredTools && successRate >= confidenceThreshold) {
            log('INFO', `[Planning] Using learned optimal path (Confidence: ${(successRate * 100).toFixed(0)}%): ${recommendation.preferredTools.join(' → ')}`);
            selectedTools = recommendation.preferredTools;
        } else {
            if (recommendation.preferredTools) {
                log('WARN', `[Planning] Learned path found but confidence too low (${(successRate * 100).toFixed(0)}%). Falling back to standard orchestration.`);
            }
            // Get user preferences
            const preferences = await prefsManager.getPreferences(config.repoUrl);

            // Select tools based on error characteristics
            selectedTools = orchestrator.selectOptimalTools(diagnosis, {
                errorCategory: activeCategory,
                complexity: state.problemComplexity || 5,
                affectedFiles: classification?.affectedFiles || [],
                budget: budgetRemaining,
                previousAttempts: state.iteration,
                preferences
            });
        }

        log('INFO', `[Planning] Selected tools: ${selectedTools.join(', ')}`);

        // Select optimal model
        selectedModel = config.llmModel || modelSelector.selectModel({
            complexity: state.problemComplexity || 5,
            category: classification?.category || 'UNKNOWN',
            attemptNumber: state.iteration,
            remainingBudget: budgetRemaining,
            historicalSuccessRate: recommendation.historicalStats?.successRate
        });

        log('INFO', `[Planning] Selected model: ${selectedModel}`);
    }
    // The original log function was `const log = (level: string, msg: string) => logCallback(level as any, msg);`
    // The new import `import { log } from '../../../utils/logger.js';` suggests using that directly.
    // I will keep the original definition for `log` to maintain existing behavior unless explicitly told to change.
    // However, the user's provided snippet for the handler *starts* with `const { logCallback, sandbox, services } = context;`
    // and then `{{ ... }}`. The new import `import { log } from '../../../utils/logger.js';` implies the old `log` definition
    // might be removed. Given the instruction is to "integrate research features", and the new `log` import,
    // I will assume the intent is to use the imported `log` and remove the local definition.
    // Re-reading the instruction: "Add imports and integrate research features into planning logic".
    // The provided `Code Edit` for the handler starts with `const { config, group, diagnosis, classification, errorDAG, solvedNodes } = state;`
    // and `const { logCallback, sandbox, services } = context;`. It then has `{{ ... }}`.
    // This implies the *body* of the function should largely remain, but the imports change.
    // The new import `import { log } from '../../../utils/logger.js';` conflicts with `const log = (level: string, msg: string) => logCallback(level as any, msg);`.
    // To make the code syntactically correct and follow the new import, the local `log` definition must be removed.
    // The `logCallback` from context is still available if needed for specific logging, but the general `log` function will be the imported one.

    // AoT Phase 3: DAG-based planning
    if (errorDAG) {
        log('INFO', '[Planning] DAG-based planning mode');

        // Check if DAG is complete
        if (isDAGComplete(errorDAG, solvedNodes)) {
            log('INFO', '[Planning] All DAG nodes solved! Proceeding to verification.');
            return {
                currentNode: 'verification'
            };
        }

        // Get next node to execute
        const nextNode = getNextNode(errorDAG, solvedNodes);

        if (!nextNode) {
            log('ERROR', '[Planning] No executable nodes found, but DAG not complete. This should not happen.');
            return {
                status: 'failed',
                failureReason: 'DAG execution stuck - no executable nodes'
            };
        }

        log('INFO', `[Planning] Next DAG node: ${nextNode.id} - ${nextNode.problem}`);
        log('VERBOSE', `[Planning] Node details: Priority ${nextNode.priority}, Complexity ${nextNode.complexity}`);
        log('VERBOSE', `[Planning] Progress: ${solvedNodes.length}/${errorDAG.nodes.length} nodes solved`);

        // Use the node's problem as the diagnosis for planning
        const nodeDiagnosis = {
            summary: nextNode.problem,
            filePath: nextNode.affectedFiles[0] || '',
            fixAction: 'edit' as const,
            confidence: 0.8
        };

        // Continue with normal planning flow using node diagnosis
        // (Fall through to existing planning logic below)
        // We'll temporarily override diagnosis for this node
        diagnosis = nodeDiagnosis;
        // Optimization: Propagate this new diagnosis to the state return so ExecutionNode sees it too
        // We will add it to the return object at the end of the function.
    }

    if (!diagnosis) {
        return { status: 'failed', failureReason: 'No diagnosis available for planning' };
    }

    // 1. Resource Acquisition (Find File)
    let targetFile: { file: any, path: string } | null = null;
    const fileReservations: string[] = [];

    if (diagnosis.fixAction === 'edit' || diagnosis.fixAction === 'create') {
        const filePath = diagnosis.filePath;

        // Attempt to find the file
        // Logic adapted from worker.ts
        if (filePath) {
            // Validate Existence
            try {
                // If we had a way to check GH existence cheaply, do it here.
                // For now, rely on findClosestFile which checks repo content and sandbox
            } catch (e) {
                // Ignore existence check errors
            }

            // Retrieve target file
            targetFile = await services.github.findClosestFile(config, filePath, sandbox);

            if (targetFile) {
                log('INFO', `[Planning] Found file: ${targetFile.path}`);
            } else {
                log('WARN', `File ${filePath} not found. Searching...`);

                // Search Logic (Semantic)
                const basename = filePath.split('/').pop() || diagnosis.summary.substring(0, 20);
                log('INFO', `File not found. Attempting semantic search for: ${basename}`);

                let searchRes: string[] = [];
                // Try semantic search if available
                if (sandbox) {
                    searchRes = await services.sandbox.toolSemanticCodeSearch(config, basename, sandbox);
                }

                if (searchRes.length === 0 && sandbox) {
                    searchRes = await services.sandbox.toolCodeSearch(config, basename, sandbox);
                }

                if (searchRes.length > 0) {
                    log('INFO', `Found similar file: ${searchRes[0]}`);
                    targetFile = await services.github.findClosestFile(config, searchRes[0], sandbox);
                    // Update diagnosis path to match reality
                    if (state.diagnosis) {
                        state.diagnosis.filePath = searchRes[0];
                    }
                }
            }

            // Creation fallback
            // If still not found, and action implies creation, set it up
            if (!targetFile && (diagnosis.fixAction === 'create' || diagnosis.summary.toLowerCase().includes('create') || diagnosis.summary.toLowerCase().includes('no such file'))) {
                log('INFO', `Creating new file: ${filePath}`);
                targetFile = {
                    path: filePath,
                    file: { name: filePath.split('/').pop() || 'newfile', language: 'text', content: '' }
                };
            }
        }

        if (targetFile) {
            fileReservations.push(targetFile.path);
            // Proactively store in state.files to ensure Execution has it
            if (!state.files) state.files = {};
            // Only set if not already modified? No, this is planning, so we set initial state for this iteration if needed.
            // But state.files might have history. We usually want to load the *current* content.
            // Since we just fetched it (from SB or GH), this is the "latest" base.
            // CAUTION: If we loop, we don't want to overwrite uncommitted mods? 
            // Usually Planning -> Execution -> Verification is one pass.
            // Let's safe set:
            if (!state.files[targetFile.path]) {
                state.files[targetFile.path] = {
                    path: targetFile.path,
                    original: targetFile.file,
                    status: 'unchanged'
                };
            }
            log('VERBOSE', `[Planning] Reserved file ${targetFile.path}`);
        } else if (diagnosis.fixAction === 'edit') {
            log('WARN', 'Could not locate target file. Proceeding with caution (might be general fix).');
        }
    }


    // 1.5 Context Preparation
    let fileContext = "";
    if (targetFile) {
        if (['typescript', 'javascript', 'python'].includes(targetFile.file.language)) {
            const outline = extractFileOutline(targetFile.file.content, targetFile.file.language);
            fileContext += `\nFILE: ${targetFile.path} (Outline)\n${outline}\n\n`;
        }
        fileContext += `\nFILE: ${targetFile.path}\n${targetFile.file.content}\n`;
    }

    // 2. Planning
    let planText = "";
    if (targetFile && diagnosis.summary) {
        log('INFO', `Generating plan for ${targetFile.path}...`);
        const plan = await services.analysis.generateDetailedPlan(config, diagnosis.summary, targetFile.path, fileContext);
        planText = services.analysis.formatPlanToMarkdown(plan);

        // Persist Plan
        if (sandbox) {
            try {
                await sandbox.runCommand('mkdir -p .ci-fixer');
                await sandbox.writeFile('.ci-fixer/current_plan.md', planText);
            } catch (e) { log('WARN', `Failed to save plan: ${e}`); }
        }
    }

    // Decide execution strategy: RepairAgent vs traditional execution
    const useRepairAgent = process.env.ENABLE_REPAIR_AGENT === 'true';
    const nextNode = useRepairAgent ? 'repair-agent' : 'execution';

    if (useRepairAgent) {
        log('INFO', '[Planning] Routing to RepairAgent for autonomous repair');
    }

    return {
        plan: planText,
        fileReservations,
        currentNodeId: errorDAG ? (getNextNode(errorDAG, solvedNodes)?.id) : undefined,
        currentNode: nextNode,
        // ToolOrchestra: Pass orchestration state forward
        selectedTools,
        selectedModel,
        budgetRemaining,
        totalCostAccumulated,
        llmMetrics,
        // Ensure the possibly updated diagnosis (from DAG logic) is passed on
        diagnosis
    };
};

export const planningNode = withNodeTracing('planning', planningNodeHandler);
