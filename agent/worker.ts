
import { db } from '../db/client.js';
import { SandboxEnvironment } from '../sandbox.js';
import { getCachedRepoContext } from '../services/context-compiler.js';
import { AppConfig, RunGroup, AgentPhase, AgentState, LogLine, FileChange } from '../types.js';
import {
    toolScanDependencies, toolCodeSearch, toolWebSearch, toolLintCheck,
    prepareSandbox
} from '../services/sandbox/SandboxService.js';
import {
    getWorkflowLogs, findClosestFile
} from '../services/github/GitHubService.js';
import {
    diagnoseError, generateDetailedPlan, generateFix, judgeFix,
    generateRepoSummary, DiagnosisResult, runSandboxTest
} from '../services/analysis/LogAnalysisService.js';
import { ReproductionInferenceService } from '../services/reproduction-inference.js';
import {
    validateFileExists, validateCommand, type RepositoryProfile
} from '../validation.js';
import {
    classifyError, classifyErrorWithHistory, formatErrorSummary, getErrorPriority, isCascadingError,
    type ClassifiedError
} from '../errorClassification.js';
import { recordFixAttempt, recordAgentMetrics, recordReproductionInference } from '../services/metrics.js';
import { extractFixPattern, findSimilarFixes } from '../services/knowledge-base.js';
import { getSuggestedActions } from '../services/action-library.js';
import { getImmediateDependencies } from '../services/dependency-analyzer.js';
import { thinLog, formatHistorySummary, formatPlanToMarkdown, type IterationSummary } from '../services/context-manager.js';
import {
    recordErrorDependency, hasBlockingDependencies, markErrorInProgress,
    markErrorResolved, getBlockedErrors
} from '../services/dependency-tracker.js';
import { recordDecision, recordAttempt as recordNoteAttempt, formatNotesForPrompt } from '../services/notes-manager.js';
import { clusterError } from '../services/error-clustering.js';

import { ServiceContainer } from '../services/container.js';
import { ProvisioningService } from '../services/sandbox/ProvisioningService.js';

export async function runWorkerTask(
    config: AppConfig,
    group: RunGroup,
    sandbox: SandboxEnvironment | undefined,
    profile: RepositoryProfile | undefined,
    initialRepoContext: string,
    services: ServiceContainer,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {

    const MAX_ITERATIONS = 5;
    const currentState: AgentState = {
        groupId: group.id,
        name: group.name,
        phase: AgentPhase.IDLE,
        iteration: 0,
        status: 'working',
        files: {},
        fileReservations: []
    };

    // Metrics tracking
    const runStartTime = Date.now();
    const iterationMetrics: Array<{ iteration: number; action: string; success: boolean; durationMs: number; filesChanged: string[] }> = [];

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
        const { logText: rawLogText, headSha } = await getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken, 'standard');

        // [STAGE 3] Context Thinning: Prevent massive logs from overflowing context
        const logText = thinLog(rawLogText, 300); // Keep max 300 lines

        let currentLogText = logText;
        // [STAGE 3] Context Preservation: Store original error to prevent drift
        const initialLogText = logText;

        // Loop State
        let diagnosis: DiagnosisResult = { summary: "", filePath: "", fixAction: 'edit', reproductionCommand: undefined };
        let targetFile: { file: any, path: string } | null = null;
        let currentErrorFactId: string | undefined = undefined;
        const fileAttempts: Record<string, number> = {};
        const classifiedErrors: ClassifiedError[] = [];
        const feedbackHistory: string[] = [];
        const iterationSummaries: IterationSummary[] = [];
        const inferenceService = new ReproductionInferenceService();

    for (let i = 0; i < MAX_ITERATIONS; i++) {
            currentState.iteration = i;
            updateStateCallback(group.id, { ...currentState });

            const iterationStartTime = Date.now();

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

            // [STAGE 3] Pass profile and previous classification for context-aware diagnosis
            const classificationForDiagnosis = classifiedErrors.length > 0 ? {
                category: classifiedErrors[classifiedErrors.length - 1].category,
                priority: getErrorPriority(classifiedErrors[classifiedErrors.length - 1].category),
                confidence: classifiedErrors[classifiedErrors.length - 1].confidence,
                affectedFiles: classifiedErrors[classifiedErrors.length - 1].affectedFiles,
                suggestedAction: classifiedErrors[classifiedErrors.length - 1].suggestedAction
            } : undefined;

            diagnosis = await diagnoseError(config, currentLogText, diagContext, profile, classificationForDiagnosis, feedbackHistory);

            log('INFO', `Diagnosis [v${i + 1}]: ${diagnosis.summary} (Action: ${diagnosis.fixAction})`);

            // --- NEW: Reproduction Command Inference (Phase 3) ---
            if (!diagnosis.reproductionCommand && sandbox) {
                log('INFO', '[Inference] Reproduction command missing. Attempting inference...');
                const repoPath = typeof sandbox.getLocalPath === 'function' ? sandbox.getLocalPath() : '.';
                const inferred = await inferenceService.inferCommand(repoPath, config, sandbox);
                
                if (inferred) {
                    log('SUCCESS', `[Inference] Inferred command: ${inferred.command} (Strategy: ${inferred.strategy})`);
                    diagnosis.reproductionCommand = inferred.command;
                    recordReproductionInference(inferred.strategy, true);
                } else {
                    log('WARN', '[Inference] Could not infer reproduction command.');
                    recordReproductionInference('none', false);
                }
            }
            // ----------------------------------------------------

            // [Knowledge Graph] Check History & Create Error Fact
            if (i === 0) { // Check only on first pass to avoid spamming self-loops
                try {
                    // Find any previous attempts to fix this specific error in this file
                    const previousAttempt = await db.errorFact.findFirst({
                        where: {
                            summary: diagnosis.summary,
                            filePath: diagnosis.filePath || '',
                        }
                    });

                    if (previousAttempt) {
                        log('WARN', `[Knowledge Graph] CAUTION: A similar error was diagnosed previously (Run ${previousAttempt.runId}). Be careful not to repeat mistakes.`);
                        feedbackHistory.push(`[History] You have previously encountered this error in '${diagnosis.filePath}'. Ensure your new fix is different.`);
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
                                timestamp: new Date().toISOString()
                            })
                        }
                    });
                    currentErrorFactId = errorFact.id;

                    // Check for blocking dependencies
                    const isBlocked = await hasBlockingDependencies(errorFact.id);
                    if (isBlocked) {
                        const blockers = await getBlockedErrors(errorFact.id);
                        log('WARN', `[Dependency] This error is blocked by ${blockers[0]?.blockedBy.length || 0} unresolved error(s)`);
                        if (blockers[0]?.blockedBy.length > 0) {
                            log('INFO', `[Dependency] Blocked by: ${blockers[0].blockedBy.map(b => b.summary).join(', ')}`);
                        }
                        continue; // Skip to next iteration
                    }
                } catch (e) { console.error("[KB] Failed to query/write facts", e); }
            }

            if (diagnosis.reproductionCommand) {
                log('INFO', `Reproduction Command identified: ${diagnosis.reproductionCommand}`);
            }

            // [ENHANCED] Error Classification with Knowledge Base
            const classified = await classifyErrorWithHistory(currentLogText, profile);
            classifiedErrors.push(classified);

            // Cluster error for cross-run pattern detection
            if (currentErrorFactId && i === 0) {
                try {
                    await clusterError(
                        currentErrorFactId,
                        classified.category,
                        classified.errorMessage,
                        classified.affectedFiles
                    );
                } catch (e) {
                    log('WARN', `[Clustering] Failed to cluster error: ${e}`);
                }
            }

            // Check for historical matches
            if (classified.historicalMatches && classified.historicalMatches.length > 0) {
                const topMatch = classified.historicalMatches[0];
                if (topMatch.similarity > 0.85) {
                    log('INFO', `[Knowledge Base] Found similar historical fix (similarity: ${(topMatch.similarity * 100).toFixed(0)}%)`);
                    log('VERBOSE', `[Knowledge Base] Historical solution: ${JSON.stringify(topMatch.pattern.fixTemplate).substring(0, 100)}...`);
                    // Could auto-apply high-confidence historical fixes here
                }
            }

            // Get suggested actions from action library
            if (diagnosis.filePath) {
                const suggestions = await getSuggestedActions(classified, diagnosis.filePath, 3);
                if (suggestions.length > 0) {
                    log('INFO', `[Action Library] Top suggestions:`);
                    suggestions.forEach((s, idx) => {
                        log('VERBOSE', `  ${idx + 1}. ${s.template.actionType} (confidence: ${(s.confidence * 100).toFixed(0)}%) - ${s.reasoning}`);
                    });
                }
            }

            const priority = getErrorPriority(classified.category);
            log('INFO', `[Classification] Category: ${classified.category}, Priority: ${priority}/4, Confidence: ${(classified.confidence * 100).toFixed(0)}%`);

            if (classified.affectedFiles.length > 0) {
                log('VERBOSE', `[Classification] Affected files: ${classified.affectedFiles.join(', ')}`);

                // [STAGE 2 ACTIVE] Use classified files as hints if diagnosis missed them
                if (!diagnosis.filePath && classified.affectedFiles.length > 0) {
                    diagnosis.filePath = classified.affectedFiles[0];
                    log('INFO', `[Classification] Using affected file from classification: ${diagnosis.filePath}`);
                }
            }

            if (classified.suggestedAction) {
                log('INFO', `[Classification] Suggestion: ${classified.suggestedAction}`);
            }

            // [STAGE 2 ACTIVE] Skip cascading errors - focus on root cause
            if (classifiedErrors.length > 1) {
                const previous = classifiedErrors[classifiedErrors.length - 2];
                if (isCascadingError(classified, previous)) {
                    log('WARN', `[Classification] Skipping cascading error. Root cause: ${previous.category}`);
                    currentLogText = previous.rootCauseLog;
                    continue;
                }
            }

            // [STAGE 2 ACTIVE] Priority-based iteration limits
            // New Priority Scale: 1 (Highest) to 4 (Lowest)
            // We limit iterations for lower priority errors (3=Runtime/Infra, 4=Test, 5=Unknown)
            if (priority >= 3 && i >= 2) {
                log('INFO', `[Classification] Low priority error (${priority}/4), limiting iterations`);
                if (i > 2) {
                    log('WARN', `Max iterations for low-priority errors reached.`);
                    break;
                }
            }


            // 1.5 REPRODUCTION (TDR)
            if (diagnosis.reproductionCommand && sandbox) {
                // [STAGE 2 ACTIVE] Command Validation with auto-correction
                if (profile) {
                    const cmdValidation = validateCommand(diagnosis.reproductionCommand, profile);
                    if (!cmdValidation.valid) {
                        log('WARN', `[Validation] Reproduction command invalid: ${cmdValidation.reason}`);
                        if (cmdValidation.suggestion) {
                            log('INFO', `[Validation] Auto-correcting to: ${cmdValidation.suggestion}`);
                            diagnosis.reproductionCommand = cmdValidation.suggestion;
                        } else {
                            log('WARN', `[Validation] Skipping reproduction due to invalid command`);
                            diagnosis.reproductionCommand = undefined; // Clear invalid command
                        }
                    } else {
                        log('VERBOSE', `[Validation] Reproduction command validated`);
                    }
                }

                // Only proceed if we have a valid command
                if (!diagnosis.reproductionCommand) {
                    log('INFO', 'Skipping reproduction phase (no valid command)');
                    continue; // Skip to next phase
                }

                // Should we define a 'reproduce' phase type? Using REPRODUCE if available or TOOL_USE
                // Assuming AgentPhase.REPRODUCE exists in types.ts (checked logic in agent.ts implies it does)
                currentState.phase = AgentPhase.REPRODUCE;
                updateStateCallback(group.id, { ...currentState });
                log('INFO', `Attempting to reproduce failure...`);

                // Ensure test runner is present
                const provisioning = new ProvisioningService(sandbox);
                const runnerMatch = diagnosis.reproductionCommand.match(/^(pytest|vitest|jest|mocha|tox|unittest)\b/);
                if (runnerMatch) {
                    const runner = runnerMatch[1];
                    log('VERBOSE', `[Provisioning] Ensuring runner '${runner}' is available...`);
                    await provisioning.ensureRunner(runner);
                }

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

                // [STAGE 2 ACTIVE] Per-file attempt tracking
                if (diagnosis.filePath) {
                    fileAttempts[diagnosis.filePath] = (fileAttempts[diagnosis.filePath] || 0) + 1;
                    if (fileAttempts[diagnosis.filePath] > 3) {
                        log('WARN', `[Validation] Too many attempts on ${diagnosis.filePath} (${fileAttempts[diagnosis.filePath]}). Skipping.`);
                        continue;
                    }
                }

                // [STAGE 2 ACTIVE] File Validation with attempt tracking
                if (diagnosis.filePath) {
                    try {
                        const [owner, repo] = config.repoUrl.split('/').slice(-2);
                        const fileExists = await validateFileExists(
                            owner,
                            repo,
                            headSha,
                            diagnosis.filePath,
                            config.githubToken
                        );

                        if (!fileExists) {
                            log('WARN', `[Validation] Diagnosed file '${diagnosis.filePath}' does not exist in repository`);
                            // Track for potential file creation mode
                        } else {
                            log('VERBOSE', `[Validation] File '${diagnosis.filePath}' exists`);
                        }
                    } catch (e: any) {
                        log('WARN', `[Validation] Could not validate file existence: ${e.message}`);
                    }
                }

                // Resolve Target File
                targetFile = await findClosestFile(config, diagnosis.filePath);
                if (!targetFile) {
                    log('WARN', `File '${diagnosis.filePath}' not found. Searching repo...`);
                    // [STAGE 3] Improved Search Strategy: Use basename first
                    const basename = diagnosis.filePath ? diagnosis.filePath.split('/').pop() : diagnosis.summary.substring(0, 30);
                    const query = (basename && basename.length > 3) ? basename : diagnosis.filePath;
                    const cleanQuery = query || "error";

                    // [g3-feature] Use structure search if query looks like a symbol (no extension)
                    const isSymbol = cleanQuery && !cleanQuery.includes('.') && !cleanQuery.includes('/');
                    let searchResults = await toolCodeSearch(config, cleanQuery, sandbox, isSymbol ? 'def' : 'ref');

                    // Fallback to reference search if definition search yielded nothing
                    if (searchResults.length === 0 && isSymbol) {
                        searchResults = await toolCodeSearch(config, cleanQuery, sandbox, 'ref');
                    }

                    if (searchResults.length > 0) {
                        log('INFO', `Search found potential match: ${searchResults[0]}`);
                        // Update diagnosis to reflect the actual file found
                        diagnosis.filePath = searchResults[0];
                        targetFile = await findClosestFile(config, searchResults[0]);
                    }
                }

                // Create File Fallback
                if (!targetFile) {
                    if (diagnosis.summary.toLowerCase().includes("no such file") ||
                        diagnosis.summary.toLowerCase().includes("not found") ||
                        diagnosis.summary.toLowerCase().includes("missing")) {

                        // [STAGE 3] Double check with code search before giving up
                        log('INFO', `File not found in expected location. Searching repo...`);
                        const searchRes = await toolCodeSearch(config, diagnosis.filePath || diagnosis.summary.substring(0, 50), sandbox);
                        if (searchRes.length > 0) {
                            log('INFO', `Found similar file: ${searchRes[0]}. Using that.`);
                            targetFile = await findClosestFile(config, searchRes[0]);
                        } else {
                            // Only trigger create mode if explicitly requested or very confident
                            if (diagnosis.fixAction === 'edit' && !diagnosis.summary.toLowerCase().includes("create")) {
                                log('WARN', "Target file missing and no replacement found. Asking for re-diagnosis...");
                                feedbackHistory.push(`File '${diagnosis.filePath}' not found in repo. Do not edit it unless you create it.`);
                                continue;
                            }
                            log('INFO', `Target file missing. CREATE mode: ${diagnosis.filePath || 'new_file.txt'}`);
                            targetFile = {
                                path: diagnosis.filePath || 'new_file.txt',
                                file: { name: diagnosis.filePath?.split('/').pop() || 'new_file.txt', language: 'text', content: "" }
                            };
                        }
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
            if (targetFile) {
                const plan = await generateDetailedPlan(config, diagnosis.summary, targetFile.path);

                // [g3-feature] Persistent Planning
                if (sandbox) {
                    try {
                        const planMd = formatPlanToMarkdown(plan);
                        await sandbox.runCommand('mkdir -p .ci-fixer'); // Ensure dir exists
                        await sandbox.writeFile('.ci-fixer/current_plan.md', planMd);
                        log('INFO', 'Persisted implementation plan to .ci-fixer/current_plan.md');
                    } catch (e) {
                        log('WARN', `Failed to save plan artifact: ${e}`);
                    }
                }
            }

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

                        // Detect secondary issues revealed by command failure
                        const secondaryError = await classifyErrorWithHistory(cmdResult.output, profile);
                        if (secondaryError.category !== classified.category && currentErrorFactId) {
                            log('INFO', `[Discovery] Found secondary issue: ${secondaryError.category}`);

                            try {
                                // Create new error fact for discovered issue
                                const discoveredFact = await db.errorFact.create({
                                    data: {
                                        summary: secondaryError.errorMessage,
                                        filePath: secondaryError.affectedFiles[0] || '',
                                        fixAction: 'edit',
                                        runId: group.id,
                                        status: 'open',
                                        notes: JSON.stringify({
                                            discoveredDuring: diagnosis.summary,
                                            discoveryContext: 'command_execution',
                                            command: cmd
                                        })
                                    }
                                });

                                // Record discovered-from relationship
                                await recordErrorDependency({
                                    sourceErrorId: discoveredFact.id,
                                    targetErrorId: currentErrorFactId,
                                    relationshipType: 'discovered_from',
                                    metadata: { command: cmd, iteration: i }
                                });
                            } catch (e) {
                                log('WARN', `[Discovery] Failed to record secondary issue: ${e}`);
                            }
                        }

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
                if (iterationSummaries.length > 0) {
                    extraContext += formatHistorySummary(iterationSummaries) + "\n";
                }
                // Fallback to raw history if needed, or if summary missed details
                if (feedbackHistory.length > 0 && iterationSummaries.length === 0) {
                    extraContext += `\n\nPREVIOUS ATTEMPTS FAILED. REVIEW FEEDBACK:\n${feedbackHistory.join('\n')}\n`;
                }
                if (i > 0) {
                    const webResult = await toolWebSearch(config, diagnosis.summary);
                    extraContext += `\nWEB SEARCH RESULTS:\n${webResult}`;
                }

                // [Phase 3] Automatic Dependency Context
                try {
                    const deps = await getImmediateDependencies(targetFile.path, targetFile.file.content, targetFile.file.language);
                    if (deps.length > 0) {
                        log('INFO', `Found ${deps.length} dependencies. Fetching context...`);
                        let depContext = "\n\n=== AUTOMATIC CONTEXT: DEPENDENCIES ===\n";
                        let addedCount = 0;
                        for (const dep of deps) {
                            if (addedCount >= 3) break; // Limit to top 3 to avoid token explosion
                            const depFile = await findClosestFile(config, dep);
                            if (depFile) {
                                // Trim content
                                const content = thinLog(depFile.file.content, 50); // Keep it brief
                                depContext += `\n--- FILE: ${depFile.path} ---\n${content}\n`;
                                addedCount++;
                            }
                        }
                        if (addedCount > 0) extraContext += depContext;
                    }
                } catch (e: any) {
                    log('WARN', `Failed to fetch dependency context: ${e.message}`);
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

                    // [STAGE 3] Smart Verification for CI Files
                    const isCIFile = targetFile.path.startsWith('.github/workflows/');

                    log('VERBOSE', 'Applying fix to sandbox for verification...');
                    await sandbox.writeFile(targetFile.path, fixCode);

                    log('INFO', `Verifying fix with reproduction command...`);
                    const res = await sandbox.runCommand(diagnosis.reproductionCommand);

                    if (res.exitCode !== 0) {
                        if (isCIFile) {
                            // Analyze if it's an environment issue
                            const verifyClassification = await classifyErrorWithHistory(res.stdout + res.stderr, profile);
                            const envCategories = ['environment', 'setup', 'infrastructure', 'memory', 'disk'];

                            // [STAGE 3] YAML Syntax Error Detection
                            if ((res.stderr + res.stdout).includes('YAML Syntax Error') ||
                                (res.stderr + res.stdout).includes('syntax error') ||
                                (res.stderr + res.stdout).includes('mapping values are not allowed')) {
                                log('WARN', `Local Verification Failed: YAML Syntax Error detected.`);
                                feedbackHistory.push(`YAML Syntax Error in ${targetFile.path}: ${res.stderr.substring(0, 300)}`);
                                currentLogText = initialLogText + "\n\n[VERIFICATION ERROR]\n" + res.stderr; // Append to original context
                                continue;
                            }

                            if (envCategories.includes(verifyClassification.category.toLowerCase()) ||
                                (res.stderr + res.stdout).includes('No space left') ||
                                (res.stderr + res.stdout).includes('docker: command not found')) {
                                log('WARN', `Verification failed due to environment mismatch (${verifyClassification.category}). Treating as SUCCESS.`);
                                log('INFO', `Environment Warning: ${verifyClassification.suggestedAction}`);
                            } else {
                                log('WARN', `Local Verification Failed (Logic Error)! Retrying...`);
                                feedbackHistory.push(`Local Verification Failed: ${res.stdout}\n${res.stderr}`);
                                // [STAGE 3] Context Preservation
                                currentLogText = initialLogText + "\n\n[VERIFICATION FAILURE]\n" + res.stdout + "\n" + res.stderr;
                                continue;
                            }
                        } else {
                            log('WARN', `Local Verification Failed! The fix did not make the test pass.`);
                            feedbackHistory.push(`Local Verification Failed: ${res.stdout}\n${res.stderr}`);
                            // [STAGE 3] Context Preservation
                            currentLogText = initialLogText + "\n\n[VERIFICATION FAILURE]\n" + res.stdout + "\n" + res.stderr;
                            continue;
                        }
                    } else {
                        log('SUCCESS', `Local Verification Passed!`);
                    }
                }

                implementationSuccess = true;
            }

            // Record iteration attempt
            const iterationDuration = Date.now() - iterationStartTime;
            const attemptFiles = activeFileChange ? [activeFileChange.path] : [];
            iterationMetrics.push({
                iteration: i,
                action: diagnosis.fixAction,
                success: implementationSuccess,
                durationMs: iterationDuration,
                filesChanged: attemptFiles
            });

            // Persist to database
            try {
                await recordFixAttempt(
                    group.id,
                    i + 1,
                    diagnosis.fixAction,
                    implementationSuccess,
                    iterationDuration,
                    attemptFiles
                );

                // [New] Record Structured Summary for Context Manager
                iterationSummaries.push({
                    iteration: i,
                    diagnosis: diagnosis.summary,
                    action: diagnosis.fixAction,
                    targetParams: diagnosis.fixAction === 'command'
                        ? (diagnosis.suggestedCommand || 'unknown command')
                        : (targetFile?.path || 'unknown file'),
                    result: implementationSuccess ? 'success' : 'failure',
                    outcomeSummary: implementationSuccess
                        ? "Implementation successful. Proceeding to verification."
                        : (feedbackHistory[feedbackHistory.length - 1] || "Implementation failed.")
                });
            } catch (e) {
                log('WARN', `Failed to record fix attempt: ${e}`);
            }

            // 4. VERIFICATION (Full Suite)
            if (implementationSuccess && activeFileChange) {
                currentState.phase = AgentPhase.TESTING;
                updateStateCallback(group.id, { ...currentState });

                const testResult = await runSandboxTest(config, group, i, true, activeFileChange, diagnosis.summary, logCallback, currentState.files, sandbox, diagnosis.reproductionCommand);

                if (testResult.passed) {
                    currentState.status = 'success';
                    currentState.phase = AgentPhase.SUCCESS;
                    currentState.message = "Fix verified successfully.";
                    currentState.fileReservations = [];
                    updateStateCallback(group.id, { ...currentState });
                    log('SUCCESS', `Worker succeeded.`);

                    // Mark error as resolved
                    if (currentErrorFactId) {
                        try {
                            await markErrorResolved(currentErrorFactId, {
                                resolution: 'fixed',
                                filesChanged: Object.keys(currentState.files),
                                iterations: i + 1,
                                finalApproach: diagnosis.fixAction
                            });
                            log('VERBOSE', `[Dependency] Marked error as resolved`);
                        } catch (e) {
                            log('WARN', `Failed to mark error resolved: ${e}`);
                        }
                    }

                    // Record success metrics
                    const totalTime = Date.now() - runStartTime;
                    const errorCategory = classifiedErrors.length > 0 ? classifiedErrors[0].category : 'unknown';
                    try {
                        await recordAgentMetrics(group.id, 'success', i + 1, totalTime, errorCategory);
                        log('VERBOSE', `[Metrics] Recorded successful run: ${i + 1} iterations, ${totalTime}ms`);
                    } catch (e) {
                        log('WARN', `Failed to record metrics: ${e}`);
                    }

                    // Extract fix pattern for knowledge base
                    if (classifiedErrors.length > 0 && activeFileChange) {
                        try {
                            const filesChanged = Object.values(currentState.files);
                            const commandsUsed = iterationMetrics
                                .filter(m => m.action === 'command')
                                .map(m => diagnosis.suggestedCommand || '');

                            await extractFixPattern(
                                group.id,
                                classifiedErrors[0],
                                filesChanged,
                                commandsUsed
                            );
                            log('VERBOSE', `[Knowledge Base] Extracted fix pattern for future use`);
                        } catch (e) {
                            log('WARN', `Failed to extract fix pattern: ${e}`);
                        }
                    }

                    return currentState;
                } else {
                    log('WARN', `Sandbox Test Failed: ${testResult.logs.substring(0, 100)}...`);
                    feedbackHistory.push(`Test Failed: ${testResult.logs.substring(0, 200)}`);
                    // [STAGE 3] Context Preservation for retries
                    // [STAGE 3] Context Preservation for retries
                    currentLogText = initialLogText + "\n\n[TEST FAILURE]\n" + thinLog(testResult.logs, 100);

                    // Update the last summary to reflect verification failure
                    if (iterationSummaries.length > 0) {
                        iterationSummaries[iterationSummaries.length - 1].result = 'failure';
                        iterationSummaries[iterationSummaries.length - 1].outcomeSummary = `Verification failed: ${testResult.logs.substring(0, 100)}...`;
                    }
                }
            }
        }

        currentState.status = 'failed';
        currentState.phase = AgentPhase.FAILURE;
        currentState.fileReservations = [];
        updateStateCallback(group.id, { ...currentState });
        log('ERROR', `Worker failed after ${MAX_ITERATIONS} attempts.`);

        // Record failure metrics
        const totalTime = Date.now() - runStartTime;
        const errorCategory = classifiedErrors.length > 0 ? classifiedErrors[0].category : 'unknown';
        try {
            await recordAgentMetrics(group.id, 'failed', MAX_ITERATIONS, totalTime, errorCategory);
        } catch (e) {
            log('WARN', `Failed to record failure metrics: ${e}`);
        }

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
