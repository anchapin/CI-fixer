
import { AppConfig, RunGroup, AgentPhase, AgentState, LogLine, FileChange } from './types';
import {
    getWorkflowLogs, toolScanDependencies, diagnoseError,
    findClosestFile, toolCodeSearch, generateDetailedPlan,
    toolWebSearch, generateFix, toolLintCheck, judgeFix, runSandboxTest,
    runDevShellCommand, DiagnosisResult
} from './services';

export async function runIndependentAgentLoop(
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {

    const MAX_ITERATIONS = 5; // Increased for multi-step fixes
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
        log('INFO', `Starting analysis for workflow: ${group.name}`);

        // Initial Log Retrieval
        let { logText, headSha } = await getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken, 'standard');
        let currentLogText = logText;

        // Loop State
        let diagnosis: DiagnosisResult = { summary: "", filePath: "", fixAction: 'edit' };
        let targetFile: { file: any, path: string } | null = null;
        const feedbackHistory: string[] = [];

        // --- DYNAMIC AGENT LOOP ---
        for (let i = 0; i < MAX_ITERATIONS; i++) {
            currentState.iteration = i;
            updateStateCallback(group.id, { ...currentState });

            // 0. LOG DISCOVERY FALLBACKS
            // If we haven't found a failed job yet, try harder strategies based on iteration
            if (currentLogText.includes("No failed job found")) {
                let strategy: 'standard' | 'extended' | 'any_error' | 'force_latest' = 'standard';

                if (i === 0) strategy = 'extended';
                else if (i === 1) strategy = 'any_error';
                else if (i === 2) strategy = 'force_latest';
                else {
                    // Give up after 3 exhaustive attempts
                    log('ERROR', `Could not find any failed jobs after trying all strategies. Aborting.`);
                    return { ...currentState, status: 'failed', message: "No failed job found in workflow." };
                }

                log('WARN', `Log missing. Retrying with strategy: ${strategy}...`);
                const retryResult = await getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken, strategy);
                currentLogText = retryResult.logText;

                // If still missing, skip diagnosis and loop to try next strategy
                if (currentLogText.includes("No failed job found")) {
                    continue;
                }
            }

            // Check for dependency issues only once we have valid logs
            let dependencyContext = "";
            const isDependencyIssue = currentLogText.includes("ModuleNotFoundError") ||
                currentLogText.includes("ImportError") ||
                currentLogText.includes("No module named") ||
                currentLogText.includes("Missing dependency");

            if (isDependencyIssue && i === 0) { // Only scan once
                currentState.phase = AgentPhase.TOOL_USE;
                updateStateCallback(group.id, { ...currentState });
                log('TOOL', 'Invoking Dependency Inspector...');
                const depReport = await toolScanDependencies(config, headSha);
                dependencyContext = `\nDEPENDENCY REPORT:\n${depReport}\n`;
                log('VERBOSE', `Dependency Report generated.`);
            }

            // 1. DIAGNOSIS (Dynamic)
            currentState.phase = AgentPhase.UNDERSTAND;
            updateStateCallback(group.id, { ...currentState });

            if (i === 0) {
                diagnosis = await diagnoseError(config, currentLogText, initialRepoContext + dependencyContext);
            } else {
                log('INFO', `Re-evaluating errors based on latest test output...`);
                // Re-diagnose based on new logs from failed attempts
                diagnosis = await diagnoseError(config, currentLogText, initialRepoContext);
            }
            log('INFO', `Diagnosis [v${i + 1}]: ${diagnosis.summary} (Action: ${diagnosis.fixAction})`);

            // 2. RESOURCE ACQUISITION (File/Tool)
            if (diagnosis.fixAction === 'edit') {
                currentState.phase = AgentPhase.EXPLORE;
                updateStateCallback(group.id, { ...currentState });

                // Resolve Target File (Robust Discovery)
                targetFile = await findClosestFile(config, diagnosis.filePath);
                if (!targetFile) {
                    log('WARN', `File '${diagnosis.filePath}' not found. Searching repo...`);
                    const query = (diagnosis.filePath && diagnosis.filePath.length > 2) ? diagnosis.filePath : diagnosis.summary.substring(0, 100);
                    const searchResults = await toolCodeSearch(config, query);
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
            } else {
                log('INFO', `Strategy: Run Shell Command (${diagnosis.suggestedCommand || 'Automatic'})`);
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
                const cmdResult = await runDevShellCommand(config, cmd);

                if (cmdResult.exitCode !== 0) {
                    log('WARN', `Command failed: ${cmdResult.output}`);
                    feedbackHistory.push(`Command '${cmd}' failed: ${cmdResult.output}`);
                    currentLogText = cmdResult.output; // Feed command error back to diagnosis
                    continue; // Retry/Re-diagnose
                } else {
                    log('SUCCESS', `Command executed successfully.`);
                    implementationSuccess = true;
                    // Mock file change for testing phase
                    activeFileChange = { path: 'SHELL', original: { name: 'sh', language: 'sh', content: '' }, modified: { name: 'sh', language: 'sh', content: cmd }, status: 'modified' };
                }

            } else if (targetFile) {
                // Code Edit Path
                let extraContext = "";
                if (feedbackHistory.length > 0) {
                    extraContext += `\n\nPREVIOUS ATTEMPTS FAILED. REVIEW FEEDBACK:\n${feedbackHistory.join('\n')}\n`;
                    extraContext += `IMPORTANT: You MUST modify the code. If you return the exact same code, the fix will fail again.\n`;
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

                // Self-Correction (Lint)
                const lintResult = await toolLintCheck(config, fixCode, targetFile.file.language);
                if (!lintResult.valid) log('WARN', `Lint check failed: ${lintResult.error}.`);

                // Create File Change Object
                activeFileChange = {
                    path: targetFile.path,
                    original: targetFile.file,
                    modified: { ...targetFile.file, content: fixCode },
                    status: 'modified'
                };
                currentState.files[targetFile.path] = activeFileChange;
                updateStateCallback(group.id, { ...currentState });

                // Judge
                currentState.phase = AgentPhase.VERIFY;
                updateStateCallback(group.id, { ...currentState });
                const judgeResult = await judgeFix(config, targetFile.file.content, fixCode, diagnosis.summary);
                log('INFO', `Judge Score: ${judgeResult.score}/10. ${judgeResult.reasoning}`);

                if (!judgeResult.passed) {
                    feedbackHistory.push(`Judge Rejected: ${judgeResult.reasoning}`);
                    log('WARN', `Judge rejected fix. Retrying...`);
                    continue; // Loop will increment i, triggering re-diagnosis (same logs) -> new attempt
                }
                implementationSuccess = true;
            }

            // 4. VERIFICATION (Sandbox/Test)
            if (implementationSuccess && activeFileChange) {
                currentState.phase = AgentPhase.TESTING;
                updateStateCallback(group.id, { ...currentState });

                const testResult = await runSandboxTest(config, group, i, true, activeFileChange, diagnosis.summary, logCallback, currentState.files);

                if (testResult.passed) {
                    currentState.status = 'success';
                    currentState.phase = AgentPhase.SUCCESS;
                    currentState.message = "Fix verified successfully.";
                    currentState.fileReservations = [];
                    updateStateCallback(group.id, { ...currentState });
                    log('SUCCESS', `Agent ${group.name} succeeded.`);
                    return currentState;
                } else {
                    log('WARN', `Sandbox Test Failed: ${testResult.logs.substring(0, 100)}...`);
                    feedbackHistory.push(`Test Failed: ${testResult.logs.substring(0, 200)}`);
                    // CRITICAL: Update logs so next diagnosis sees the NEW error
                    currentLogText = testResult.logs;
                }
            }
        }

        currentState.status = 'failed';
        currentState.phase = AgentPhase.FAILURE;
        currentState.fileReservations = [];
        updateStateCallback(group.id, { ...currentState });
        log('ERROR', `Agent ${group.name} failed after ${MAX_ITERATIONS} attempts.`);
        return currentState;

    } catch (error: any) {
        currentState.status = 'failed';
        currentState.phase = AgentPhase.FAILURE;
        currentState.message = error.message;
        currentState.fileReservations = [];
        updateStateCallback(group.id, currentState);
        log('ERROR', `Agent crashed: ${error.message}`);
        return currentState;
    }
}
