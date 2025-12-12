
import { db } from '../db/client.js';
import { SandboxEnvironment } from '../sandbox.js';
import { getCachedRepoContext } from '../services/context-compiler.js';
import { AppConfig, RunGroup, AgentPhase, AgentState, LogLine, FileChange } from '../types.js';
import {
    getWorkflowLogs, toolScanDependencies, diagnoseError,
    findClosestFile, toolCodeSearch, generateDetailedPlan,
    toolWebSearch, generateFix, toolLintCheck, judgeFix, runSandboxTest,
    generateRepoSummary, DiagnosisResult
} from '../services.js';

export async function runWorkerTask(
    config: AppConfig,
    group: RunGroup,
    sandbox: SandboxEnvironment | undefined, // In simulation mode this might be undefined, but we should enforce it being passed
    initialRepoContext: string,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {

    const MAX_ITERATIONS = 5;
    let currentState: AgentState = {
        groupId: group.id,
        name: group.name,
        phase: AgentPhase.IDLE,
        iteration: 0,
        status: 'working',
        files: {},
        fileReservations: []
    };

    const log = (level: LogLine['level'], content: string) => {
        logCallback(level, content, group.id, group.name);
        currentState.activeLog = (currentState.activeLog || "") + `[${level}] ${content}\n`;
        updateStateCallback(group.id, { activeLog: currentState.activeLog });
    };

    try {
        currentState.phase = AgentPhase.UNDERSTAND;
        updateStateCallback(group.id, { ...currentState });
        log('INFO', `[Worker] Starting analysis for workflow: ${group.name}`);

        // Initial Log Retrieval
        let { logText, headSha } = await getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken, 'standard');
        let currentLogText = logText;

        // Loop State
        let diagnosis: DiagnosisResult = { summary: "", filePath: "", fixAction: 'edit', reproductionCommand: undefined };
        let targetFile: { file: any, path: string } | null = null;
        const feedbackHistory: string[] = [];

        // --- DYNAMIC AGENT LOOP ---
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            currentState.iteration = i;
            updateStateCallback(group.id, { ...currentState });

            // 0. LOG DISCOVERY FALLBACKS
            if (currentLogText.includes("No failed job found")) {
                let strategy: 'standard' | 'extended' | 'any_error' | 'force_latest' = 'standard';

                if (i === 0) strategy = 'extended';
                else if (i === 1) strategy = 'any_error';
                else if (i === 2) strategy = 'force_latest';
                else {
                    log('ERROR', `Could not find any failed jobs after trying all strategies. Aborting.`);
                    return { ...currentState, status: 'failed', message: "No failed job found in workflow." };
                }

                log('WARN', `Log missing. Retrying with strategy: ${strategy}...`);
                const retryResult = await getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken, strategy);
                currentLogText = retryResult.logText;

                if (currentLogText.includes("No failed job found")) {
                    continue;
                }
            }

            // Check for dependency issues
            let dependencyContext = "";
            const isDependencyIssue = currentLogText.includes("ModuleNotFoundError") ||
                currentLogText.includes("ImportError") ||
                currentLogText.includes("No module named") ||
                currentLogText.includes("Missing dependency");

            if (isDependencyIssue && i === 0) {
                currentState.phase = AgentPhase.TOOL_USE;
                updateStateCallback(group.id, { ...currentState });
                log('TOOL', 'Invoking Dependency Inspector...');
                const depReport = await toolScanDependencies(config, headSha);
                dependencyContext = `\nDEPENDENCY REPORT:\n${depReport}\n`;
                log('VERBOSE', `Dependency Report generated.`);
            }

            // 1. DIAGNOSIS
            currentState.phase = AgentPhase.UNDERSTAND;
            updateStateCallback(group.id, { ...currentState });

            const cachedSha = group.mainRun.head_sha || 'unknown';
            // Compile context using the Shared Sandbox
            const repoContext = await getCachedRepoContext(config, cachedSha, () => generateRepoSummary(config, sandbox));

            const diagContext = (i === 0) ? repoContext + dependencyContext : repoContext;
            diagnosis = await diagnoseError(config, currentLogText, diagContext);

            log('INFO', `Diagnosis [v${i + 1}]: ${diagnosis.summary} (Action: ${diagnosis.fixAction})`);

            // [Knowledge Graph] Check History
            if (i === 0) { // Check only on first pass to avoid spamming self-loops
                try {
                    // Find any previous attempts to fix this specific error in this file
                    const previousAttempt = await db.errorFact.findFirst({
                        where: {
                            summary: diagnosis.summary,
                            filePath: diagnosis.filePath || '',
                            // Check globally or per-repo? Schema doesn't have Repo.
                            // We check if we've seen this attempt in THIS run group or recent ones.
                            // Ideally we check per-RunGroup but we want "Restart persistence".
                            // So checking global history for this File Path is decent heuristic.
                            // We assume file paths are unique per project context.
                        }
                    });

                    if (previousAttempt) {
                        log('WARN', `[Knowledge Graph] CAUTION: A similar error was diagnosed previously (Run ${previousAttempt.runId}). Be careful not to repeat mistakes.`);
                        feedbackHistory.push(`[History] You have previously encountered this error in '${diagnosis.filePath}'. Ensure your new fix is different.`);
                    }

                    // Record New Fact
                    await db.errorFact.create({
                        data: {
                            summary: diagnosis.summary,
                            filePath: diagnosis.filePath || '',
                            fixAction: diagnosis.fixAction,
                            runId: group.id
                        }
                    });
                } catch (e) { console.error("[KB] Failed to query/write facts", e); }
            }

            if (diagnosis.reproductionCommand) {
                log('INFO', `Reproduction Command identified: ${diagnosis.reproductionCommand}`);
            }

            // 1.5 REPRODUCTION (TDR)
            if (diagnosis.reproductionCommand && sandbox) {
                // Should we define a 'reproduce' phase type? Using REPRODUCE if available or TOOL_USE
                // Assuming AgentPhase.REPRODUCE exists in types.ts (checked logic in agent.ts implies it does)
                currentState.phase = AgentPhase.REPRODUCE;
                updateStateCallback(group.id, { ...currentState });
                log('INFO', `Attempting to reproduce failure...`);

                const res = await sandbox.runCommand(diagnosis.reproductionCommand);
                const repro = {
                    output: res.stdout + (res.stderr ? `\n[STDERR]\n${res.stderr}` : ""),
                    exitCode: res.exitCode
                };

                if (repro.exitCode === 0) {
                    log('WARN', `Reproduction failed! The command passed unexpectedly.`);
                    feedbackHistory.push(`Reproduction passed initially. Cannot verify fix effectiveness.`);
                } else {
                    log('SUCCESS', `Failure Reproduced via command. (Exit Code: ${repro.exitCode})`);
                }
            }

            // 2. RESOURCE ACQUISITION
            if (diagnosis.fixAction === 'edit') {
                currentState.phase = AgentPhase.EXPLORE;
                updateStateCallback(group.id, { ...currentState });

                // Resolve Target File
                targetFile = await findClosestFile(config, diagnosis.filePath);
                if (!targetFile) {
                    log('WARN', `File '${diagnosis.filePath}' not found. Searching repo...`);
                    const query = (diagnosis.filePath && diagnosis.filePath.length > 2) ? diagnosis.filePath : diagnosis.summary.substring(0, 100);
                    const searchResults = await toolCodeSearch(config, query, sandbox);
                    if (searchResults.length > 0) {
                        log('INFO', `Search found potential match: ${searchResults[0]}`);
                        targetFile = await findClosestFile(config, searchResults[0]);
                    }
                }

                // Create File Fallback
                if (!targetFile) {
                    if (diagnosis.summary.toLowerCase().includes("no such file") ||
                        diagnosis.summary.toLowerCase().includes("not found") ||
                        diagnosis.summary.toLowerCase().includes("missing")) {
                        log('INFO', `Target file missing. CREATE mode: ${diagnosis.filePath || 'new_file'}`);
                        targetFile = {
                            path: diagnosis.filePath || 'new_file.txt',
                            file: { name: diagnosis.filePath?.split('/').pop() || 'new_file.txt', language: 'text', content: "" }
                        };
                    } else {
                        log('ERROR', `Could not locate source file for error: ${diagnosis.summary}`);
                        return { ...currentState, status: 'failed', message: "Target file not found." };
                    }
                }

                currentState.phase = AgentPhase.ACQUIRE_LOCK;
                currentState.fileReservations = [targetFile.path];
                updateStateCallback(group.id, { ...currentState });
            }

            currentState.phase = AgentPhase.PLAN;
            updateStateCallback(group.id, { ...currentState });
            if (targetFile) await generateDetailedPlan(config, diagnosis.summary, targetFile.path);

            // 3. IMPLEMENTATION
            currentState.phase = AgentPhase.IMPLEMENT;
            updateStateCallback(group.id, { ...currentState });

            let activeFileChange: FileChange | null = null;
            let implementationSuccess = false;

            if (diagnosis.fixAction === 'command') {
                const cmd = diagnosis.suggestedCommand || "echo 'No command suggested'";
                log('TOOL', `Executing Shell Command: ${cmd}`);

                if (sandbox) {
                    const res = await sandbox.runCommand(cmd);
                    const cmdResult = {
                        output: res.stdout + (res.stderr ? `\n[STDERR]\n${res.stderr}` : ""),
                        exitCode: res.exitCode
                    };

                    if (cmdResult.exitCode !== 0) {
                        log('WARN', `Command failed: ${cmdResult.output}`);
                        feedbackHistory.push(`Command '${cmd}' failed: ${cmdResult.output}`);
                        currentLogText = cmdResult.output;
                        continue;
                    } else {
                        log('SUCCESS', `Command executed successfully.`);
                        implementationSuccess = true;
                        activeFileChange = { path: 'SHELL', original: { name: 'sh', language: 'sh', content: '' }, modified: { name: 'sh', language: 'sh', content: cmd }, status: 'modified' };
                    }
                } else {
                    log('WARN', 'Cannot run command in Simulation Mode');
                    implementationSuccess = true; // Simulation success
                }

            } else if (targetFile) {
                let extraContext = "";
                if (feedbackHistory.length > 0) {
                    extraContext += `\n\nPREVIOUS ATTEMPTS FAILED. REVIEW FEEDBACK:\n${feedbackHistory.join('\n')}\n`;
                }
                if (i > 0) {
                    const webResult = await toolWebSearch(config, diagnosis.summary);
                    extraContext += `\nWEB SEARCH RESULTS:\n${webResult}`;
                }

                const fixCode = await generateFix(config, {
                    code: targetFile.file.content,
                    error: diagnosis.summary,
                    language: targetFile.file.language,
                    extraContext
                });

                // Lint Check
                const lintResult = await toolLintCheck(config, fixCode, targetFile.file.language, sandbox);
                if (!lintResult.valid) {
                    log('WARN', `Lint check failed: ${lintResult.error}.`);
                    feedbackHistory.push(`Linter Error: ${lintResult.error}`);
                    continue;
                }

                activeFileChange = {
                    path: targetFile.path,
                    original: targetFile.file,
                    modified: { ...targetFile.file, content: fixCode },
                    status: 'modified'
                };
                currentState.files[targetFile.path] = activeFileChange;
                updateStateCallback(group.id, { ...currentState });

                // [Knowledge Graph] Record File Mod
                try {
                    await db.fileModification.create({
                        data: {
                            path: targetFile.path,
                            runId: group.id
                        }
                    });
                } catch (e) { console.error("[KB] Failed to record entity", e); }

                // Judge
                currentState.phase = AgentPhase.VERIFY;
                updateStateCallback(group.id, { ...currentState });
                const judgeResult = await judgeFix(config, targetFile.file.content, fixCode, diagnosis.summary);
                log('INFO', `Judge Score: ${judgeResult.score}/10. ${judgeResult.reasoning}`);

                if (!judgeResult.passed) {
                    feedbackHistory.push(`Judge Rejected: ${judgeResult.reasoning}`);
                    log('WARN', `Judge rejected fix. Retrying...`);
                    continue;
                }

                // Local Verification with Repro Command
                if (diagnosis.reproductionCommand && sandbox) {
                    currentState.phase = AgentPhase.VERIFY;
                    updateStateCallback(group.id, { ...currentState });

                    // We must write the file first!
                    // Assuming services 'runSandboxTest' usually writes it? No, in 'runSandboxTest' it does.
                    // But here we are doing local verification BEFORE 'runSandboxTest'.
                    // So we must write the file manually using sandbox
                    log('VERBOSE', 'Applying fix to sandbox for verification...');
                    await sandbox.writeFile(targetFile.path, fixCode);

                    log('INFO', `Verifying fix with reproduction command...`);
                    const res = await sandbox.runCommand(diagnosis.reproductionCommand);
                    if (res.exitCode !== 0) {
                        log('WARN', `Local Verification Failed! The fix did not make the test pass.`);
                        feedbackHistory.push(`Local Verification Failed: ${res.stdout}\n${res.stderr}`);
                        currentLogText = res.stdout + "\n" + res.stderr; // Feed back
                        continue;
                    } else {
                        log('SUCCESS', `Local Verification Passed!`);
                    }
                }

                implementationSuccess = true;
            }

            // 4. VERIFICATION (Full Suite)
            if (implementationSuccess && activeFileChange) {
                currentState.phase = AgentPhase.TESTING;
                updateStateCallback(group.id, { ...currentState });

                const testResult = await runSandboxTest(config, group, i, true, activeFileChange, diagnosis.summary, logCallback, currentState.files, sandbox);

                if (testResult.passed) {
                    currentState.status = 'success';
                    currentState.phase = AgentPhase.SUCCESS;
                    currentState.message = "Fix verified successfully.";
                    currentState.fileReservations = [];
                    updateStateCallback(group.id, { ...currentState });
                    log('SUCCESS', `Worker succeeded.`);
                    return currentState;
                } else {
                    log('WARN', `Sandbox Test Failed: ${testResult.logs.substring(0, 100)}...`);
                    feedbackHistory.push(`Test Failed: ${testResult.logs.substring(0, 200)}`);
                    currentLogText = testResult.logs;
                }
            }
        }

        currentState.status = 'failed';
        currentState.phase = AgentPhase.FAILURE;
        currentState.fileReservations = [];
        updateStateCallback(group.id, { ...currentState });
        log('ERROR', `Worker failed after ${MAX_ITERATIONS} attempts.`);
        return currentState;

    } catch (error: any) {
        currentState.status = 'failed';
        currentState.phase = AgentPhase.FAILURE;
        currentState.message = error.message;
        updateStateCallback(group.id, currentState);
        log('ERROR', `Worker crashed: ${error.message}`);
        return currentState;
    }
}
