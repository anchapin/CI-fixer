import { GraphState, GraphContext, NodeHandler } from '../state.js';
import { generateFix, judgeFix } from '../../../services/analysis/LogAnalysisService.js';
import { toolLintCheck, toolWebSearch } from '../../../services/sandbox/SandboxService.js';
import { getImmediateDependencies } from '../../../services/dependency-analyzer.js';
import { thinLog, formatHistorySummary } from '../../../services/context-manager.js';
import { db as globalDb } from '../../../db/client.js';
import { FileChange } from '../../../types.js';
import { markNodeSolved } from '../../../services/dag-executor.js';
import { withNodeTracing } from './tracing-wrapper.js';

const codingNodeHandler: NodeHandler = async (state, context) => {
    const { config, group, diagnosis, refinedProblemStatement, fileReservations, iteration, initialLogText, errorDAG, currentNodeId, solvedNodes } = state;
    const { logCallback, sandbox, dbClient, services } = context;

    // Use injected dbClient or fall back to global db
    const db = dbClient || globalDb;

    const log = (level: string, msg: string) => logCallback(level as any, msg);

    if (!diagnosis) return { status: 'failed', failureReason: 'No diagnosis' };

    let activeFileChange: FileChange | null = null;
    let implementationSuccess = false;

    // A. COMMAND FIX
    if (diagnosis.fixAction === 'command') {
        const cmd = diagnosis.suggestedCommand || "echo 'No command'";
        log('TOOL', `Executing Shell Command: ${cmd}`);
        if (sandbox) {
            const res = await sandbox.runCommand(cmd);
            if (res.exitCode !== 0) {
                log('WARN', `Command failed: ${res.stderr}`);
                // In graph, maybe we reflect? For now, standard fail behavior
                // We push this to feedback logic in Verification node usually, 
                // but since we aren't creating a file, "Verification" phase might be skipped or adapted.
                // Let's assume we go to Verification to test the side effects.
            } else {
                implementationSuccess = true;
            }
        }
    }
    // B. EDIT FIX
    else if (fileReservations.length > 0) {
        const targetPath = fileReservations[0];
        // We need to fetch the file content again or rely on what we found in Planning?
        // Planning used findClosestFile but didn't store the content in state efficiently (only inside the function scope).
        // Let's assume we fetch it or Planning should have put it in state.temporaryFileCache or similar.
        // For simplicity, we re-fetch via GitHubService helper if needed, or assume we have it.
        // For this impl, I'll use a placeholder "fetch" since I don't want to import everything again.
        // Real implementation: Planning should pass the `File` object in state.

        // HACK: We will assume we can get content. 
        // In the real worker.ts, it was local variable `targetFile`.
        // I should have put it in `state`. Let's assume I fix Planning to put it in `state.targetFile` (which I need to add to interface).
        // Check `state.ts`. I didn't add it. I should add `activeFile` to State.
        // For now, I will use a mock "read from sandbox" since we are in connected mode usually?
        // Or better, add `targetFile` to `GraphState`. I will do that in the "Refactor State" step.
        // Proceeding with assumption `state.files[targetPath]` might hold it if we pre-loaded it?
        log('INFO', `[Execution] Implementing fix for ${targetPath}`);

        // Read current content
        let currentContent = "";
        if (sandbox) {
            try {
                currentContent = await sandbox.readFile(targetPath);
            } catch (e) { log('WARN', `Read failed: ${e}`); }
        }

        // Generate Code Fix
        const fixCode = await generateFix(config, {
            code: currentContent,
            error: diagnosis.summary,
            context: refinedProblemStatement || diagnosis.summary
        });

        activeFileChange = {
            path: targetPath,
            original: { name: targetPath.split('/').pop() || targetPath, content: currentContent, language: targetPath.split('.').pop() || 'text' },
            modified: { name: targetPath.split('/').pop() || targetPath, content: fixCode, language: targetPath.split('.').pop() || 'text' },
            status: 'modified'
        };

        // Lint
        const lintRes = await services.sandbox.toolLintCheck(config, fixCode, targetPath.split('.').pop() || 'text', sandbox);
        if (!lintRes.valid) {
            log('WARN', `Lint failed: ${lintRes.error}`);
            // Add to feedback for next loop
            return {
                feedback: [...state.feedback, `Lint Error: ${lintRes.error}`],
                fileReservations
            };
        }

        // Persist FileModification
        try {
            await db.fileModification.create({
                data: {
                    runId: group.id,
                    path: targetPath
                }
            });
            log('VERBOSE', `Persisted FileModification for ${targetPath}`);
        } catch (e: any) {
            log('WARN', `Failed to persist FileModification: ${e.message}`);
        }

        if (sandbox) {
            await sandbox.writeFile(targetPath, fixCode);
            implementationSuccess = true;
        }
    }

    // Update State
    const newFiles = { ...state.files };
    if (activeFileChange) {
        newFiles[activeFileChange.path] = activeFileChange;

        // [Knowledge Graph] Record File Mod
        try {
            await db.fileModification.create({
                data: {
                    path: activeFileChange.path,
                    runId: group.id
                }
            });
        } catch (e) {
            log('WARN', `[KB] Failed to record entity: ${e}`);
        }
    }

    // AoT Phase 3: Mark DAG node as solved
    if (currentNodeId && errorDAG && implementationSuccess) {
        const dagUpdate = markNodeSolved(state, currentNodeId);
        log('INFO', `[Execution] Solved DAG node: ${currentNodeId}`);
        log('VERBOSE', `[Execution] Progress: ${dagUpdate.solvedNodes?.length}/${errorDAG.nodes.length} nodes solved`);

        return {
            files: newFiles,
            activeFileChange,
            ...dagUpdate,
            currentNode: 'planning' // Go back to planning for next node
        };
    }

    return {
        files: newFiles,
        activeFileChange,
        currentNode: 'verification'
    };
};

export const codingNode = withNodeTracing('execution', codingNodeHandler);
