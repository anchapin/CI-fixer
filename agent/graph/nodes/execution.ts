import { GraphState, GraphContext, NodeHandler } from '../state.js';
import { db as globalDb } from '../../../db/client.js';
import { FileChange } from '../../../types.js';
import { withNodeTracing } from './tracing-wrapper.js';
import * as path from 'node:path';

const codingNodeHandler: NodeHandler = async (state, context) => {
    const { config, group, diagnosis, refinedProblemStatement, fileReservations, iteration, errorDAG, currentNodeId } = state;
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
                // Self-Healing: Check for missing tools
                if (res.stderr.includes('command not found') || res.stderr.includes('not found')) {
                    const missingToolMatch = res.stderr.match(/: (.*?): (command )?not found/);
                    const missingTool = missingToolMatch ? missingToolMatch[1] : null;

                    if (missingTool) {
                        log('WARN', `Detected missing tool: ${missingTool}. Attempting self-healing...`);
                        const toolMap: Record<string, string> = {
                            'docker': 'docker.io',
                            'pip': 'python3-pip',
                            'npm': 'nodejs',
                            'git': 'git',
                            'curl': 'curl',
                            'zip': 'zip',
                            'unzip': 'unzip'
                        };
                        const packageToInstall = toolMap[missingTool];
                        if (packageToInstall) {
                            const installCmd = `apt-get update && apt-get install -y ${packageToInstall}`;
                            log('TOOL', `Self-Healing: Installing ${packageToInstall}...`);
                            const installRes = await sandbox.runCommand(installCmd);
                            if (installRes.exitCode === 0) {
                                log('SUCCESS', `Successfully installed ${packageToInstall}. Retrying original command...`);
                                const retryRes = await sandbox.runCommand(cmd);
                                if (retryRes.exitCode === 0) {
                                    implementationSuccess = true;
                                    // Success path, implicitly continues.
                                }
 else {
                                    log('WARN', `Retry failed: ${retryRes.stderr}`);
                                    return {
                                        feedback: [...state.feedback, `Command Failed (Exit Code ${retryRes.exitCode}) after installing missing tool:\nStdout: ${retryRes.stdout}\nStderr: ${retryRes.stderr}`],
                                        iteration: iteration + 1,
                                        currentNode: 'analysis'
                                    };
                                }
                            } else {
                                log('WARN', `Self-healing installation failed: ${installRes.stderr}`);
                            }
                        }
                    }
                }

                if (!implementationSuccess) {
                    log('WARN', `Command failed: ${res.stderr}`);
                    return {
                        feedback: [...state.feedback, `Command Failed (Exit Code ${res.exitCode}):\nStdout: ${res.stdout}\nStderr: ${res.stderr}`],
                        iteration: iteration + 1,
                        currentNode: 'analysis'
                    };
                }
            } else {
                implementationSuccess = true;
            }
        }
    }
    // B. EDIT FIX
    else if (fileReservations.length > 0 || (diagnosis.fixAction === 'edit' && diagnosis.filePath)) {
        let targetPath = fileReservations.length > 0 ? fileReservations[0] : diagnosis.filePath!;
        log('INFO', `[Execution] Implementing fix for ${targetPath}`);

        // PATH VERIFICATION: Auto-correct hallucinations
        if (sandbox) {
            const verification = await services.discovery.findUniqueFile(targetPath, sandbox.getWorkDir());
            if (verification.found && verification.path) {
                const relativePath = path.relative(sandbox.getWorkDir(), verification.path);
                if (relativePath !== targetPath) {
                    log('SUCCESS', `[Execution] Auto-corrected path from ${targetPath} to ${relativePath}`);
                    targetPath = relativePath;
                }
            } else if (!verification.found && verification.matches.length > 1) {
                const matchlist = verification.matches.map(m => path.relative(sandbox.getWorkDir(), m)).join(', ');
                log('WARN', `[Execution] Multiple matches found for ${targetPath}: ${matchlist}. Aborting to avoid wrong file edit.`);
                return {
                    feedback: [...state.feedback, `Path Hallucination: Multiple files named '${targetPath}' found: ${matchlist}. Please specify the exact path.`],
                    iteration: iteration + 1,
                    currentNode: 'analysis'
                };
            }
        }

        // Read current content
        // Try to get from State first (populated by Planning)
        let currentContent = "";

        // Helper to safely check nested properties
        const existingFile = state.files && state.files[targetPath];

        if (existingFile && existingFile.original) {
            currentContent = existingFile.original.content;
            log('VERBOSE', `[Execution] Loaded content from state for ${targetPath}`);
        } else if (sandbox) {
            // Fallback to sandbox read (e.g. if fileReservations was empty or state missing)
            try {
                currentContent = await sandbox.readFile(targetPath);
                log('VERBOSE', `[Execution] Read content from sandbox for ${targetPath}`);
            } catch (e) {
                log('WARN', `Read failed: ${e}`);
                // If read failed, and we are editing, we might be in trouble. 
                // But assume maybe we are creating it or it's empty.
            }
        }

        // Generate Code Fix
        const fixCode = await services.analysis.generateFix(config, {
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
            log('INFO', `[Execution] Writing ${fixCode.length} bytes to ${targetPath} in sandbox...`);
            await sandbox.writeFile(targetPath, fixCode);
            implementationSuccess = true;
        } else {
            log('WARN', `[Execution] Sandbox not available. Cannot write file.`);
        }
    } else {
        log('WARN', `[Execution] No file reservations and no filePath in diagnosis. Skipping edit.`);
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
        const dagUpdate = services.context.markNodeSolved(state as any, currentNodeId);
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