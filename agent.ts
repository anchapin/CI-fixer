
import { AppConfig, RunGroup, AgentState, AgentPhase, FileChange, LogLine, CodeFile, AgentPlan } from './types';
import { 
    getWorkflowLogs, 
    toolScanDependencies, 
    diagnoseError, 
    toolCodeSearch, 
    generateDetailedPlan, 
    judgeDetailedPlan, 
    findClosestFile, 
    toolWebSearch, 
    generateFix, 
    toolLintCheck, 
    judgeFix, 
    runSandboxTest,
    compileContext // New Import
} from './services';

// Helper for normalizeCode
function normalizeCode(str: string) {
    return str.trim().replace(/\r\n|\r/g, '\n');
}

// --- INDEPENDENT AGENT LOOP ---
// This function runs entirely independently for each RunGroup
export const runIndependentAgentLoop = async (
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    updateStateCallback: (id: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], msg: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> => {
    const MAX_RETRIES = 3;
    let iteration = 0;
    let previousFeedback: string | undefined = undefined;
    let dependencyContext = "";
    
    // Log Wrapper
    const log = (level: LogLine['level'], msg: string, id: string = group.id, name: string = group.name) => logCallback(level, msg, id, name);
    const judgeLog = (msg: string) => logCallback('WARN', `[JUDGE] ${msg}`, 'JUDGE', 'Judge');

    // Initialize State with empty file registry
    const initialState: AgentState = { 
        groupId: group.id, 
        name: group.name, 
        phase: AgentPhase.UNDERSTAND, 
        iteration: 0, 
        status: 'working', 
        files: {},
        fileReservations: [] 
    };
    updateStateCallback(group.id, initialState);
    
    let currentState = initialState; // Local tracker for return value
    let persistentFileContent: CodeFile | null = null; // Store partial fixes
    let persistentFilePath: string | null = null; // Correctly track the path associated with persistent content
    
    // State to persist logs across iterations for adaptive diagnosis
    let currentLogText = "";
    let headSha = "";

    while (iteration < MAX_RETRIES) {
        try {
            // 1. UNDERSTAND
            currentState = { ...currentState, phase: AgentPhase.UNDERSTAND, iteration, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            const isRetry = iteration > 0;
            log('INFO', !isRetry ? `Agent Activated. Analyzing Run #${group.mainRun.id}...` : `Retry #${iteration}. Re-analy failure...`);
            
            // Initial Log Fetch (Only if empty)
            if (!currentLogText || !headSha) {
                const runData = await getWorkflowLogs(config.repoUrl, group.mainRun.id, config.githubToken);
                currentLogText = runData.logText;
                headSha = runData.headSha;
                log('VERBOSE', `[CTX] Fetched logs (${currentLogText.length} chars). SHA: ${headSha}`);
                log('VERBOSE', `[CTX] Log Snippet: ${currentLogText.substring(0, 200)}...`);
            } else if (isRetry) {
                log('INFO', 'Adapting diagnosis based on latest sandbox execution logs...');
            }

            // --- TOOL: SCAN DEPENDENCIES (If import error suspected) ---
            const isDependencyIssue = currentLogText.includes("ModuleNotFoundError") || 
                                      currentLogText.includes("ImportError") || 
                                      currentLogText.includes("No module named") || 
                                      currentLogText.includes("Missing dependency") || 
                                      currentLogText.includes("package") || 
                                      currentLogText.includes("Cannot find module");
                                      
            if (isDependencyIssue && iteration === 0) {
                 currentState = { ...currentState, phase: AgentPhase.TOOL_USE };
                 updateStateCallback(group.id, currentState);
                 log('TOOL', 'Invoking Dependency Inspector (toolScanDependencies)...');
                 const depReport = await toolScanDependencies(config, headSha);
                 dependencyContext = `\nDEPENDENCY REPORT:\n${depReport}\n`;
                 log('VERBOSE', `[CTX] Dependency Report:\n${depReport}`);
                 log('INFO', 'Dependency Scan complete.');
            }

            // Diagnose
            log('DEBUG', 'Running diagnosis on log snippet...');
            const diagnosis = await diagnoseError(config, currentLogText, initialRepoContext + dependencyContext);
            if (!diagnosis) throw new Error("Diagnosis failed to return a valid object.");
            const safeSummary = diagnosis.summary || "Unknown Error";
            log('VERBOSE', `[DIAGNOSIS] Raw: ${JSON.stringify(diagnosis)}`);
            
            // Fix: enhanced path cleaning to handle ./src prefix
            let cleanPath = diagnosis.filePath ? diagnosis.filePath.replace(/^(\.\/|\/)+/, '') : '';
            
            // --- TOOL: CODE SEARCH (If path ambiguous) ---
            if (!cleanPath || cleanPath === 'unknown' || cleanPath === '') {
                 currentState = { ...currentState, phase: AgentPhase.TOOL_USE };
                 updateStateCallback(group.id, currentState);
                 log('TOOL', `Invoking Code Search for error keywords...`);
                 const searchResults = await toolCodeSearch(config, safeSummary.substring(0, 30));
                 log('VERBOSE', `[TOOL:CodeSearch] Results: ${JSON.stringify(searchResults)}`);
                 if (searchResults.length > 0) {
                     cleanPath = searchResults[0];
                     log('INFO', `Search found potential match: ${cleanPath}`);
                 } else {
                     log('VERBOSE', `[TOOL:CodeSearch] No results found for query: "${safeSummary.substring(0, 30)}"`);
                 }
            }

            if (!cleanPath) cleanPath = 'README.md'; // Safety fallback
            log('DEBUG', `Diagnosis: ${safeSummary} in ${cleanPath}`);

            // --- PLANNING & APPROVAL (Iteration > 0) ---
            // If this is a retry, we engage the Judge Planning Loop
            let approvedPlan: AgentPlan | undefined = undefined;
            
            if (iteration > 0) {
                 currentState = { ...currentState, phase: AgentPhase.PLAN };
                 updateStateCallback(group.id, currentState);
                 log('WARN', `Failure Detected in previous run. Initiating Strategic Planning Subroutine...`);
                 
                 let planApproved = false;
                 let planAttempts = 0;
                 let planFeedback = previousFeedback || "Previous fix failed. Create a better plan.";

                 while (!planApproved && planAttempts < 3) {
                     // Generate Plan
                     log('INFO', `Drafting Fix Strategy (Attempt ${planAttempts + 1})...`);
                     
                     // CONTEXT COMPILATION: Use strict scoping for planning
                     const planningContext = compileContext(AgentPhase.PLAN, initialRepoContext, safeSummary, undefined, currentLogText);
                     log('VERBOSE', `[CTX] Planning Context Preview:\n${planningContext.substring(0, 500)}...`);
                     
                     const plan = await generateDetailedPlan(config, safeSummary, planFeedback, planningContext);
                     log('VERBOSE', `[PLAN] Generated Plan:\n${JSON.stringify(plan, null, 2)}`);
                     
                     // --- SAFEGUARD: Malformed Plan Check ---
                     if (!plan || !Array.isArray(plan.tasks)) {
                         log('WARN', 'LLM returned a malformed plan (missing tasks). Fallback to manual strategy.');
                         // Fallback plan to prevent crash
                         const fallbackPlan: AgentPlan = { 
                             goal: "Manual Intervention (Plan Generation Failed)", 
                             tasks: [{ id: 'fallback', description: "Check logs manually and retry", status: 'pending' }], 
                             approved: false 
                         };
                         currentState = { ...currentState, currentPlan: fallbackPlan, phase: AgentPhase.PLAN_APPROVAL };
                         updateStateCallback(group.id, currentState);
                         
                         planFeedback = "Previous plan was invalid JSON (missing tasks array). Retry.";
                         planAttempts++;
                         continue; 
                     }

                     currentState = { ...currentState, currentPlan: plan, phase: AgentPhase.PLAN_APPROVAL };
                     updateStateCallback(group.id, currentState);
                     
                     // Judge Plan
                     judgeLog(`Reviewing Agent Strategy: "${plan.goal}"...`);
                     const judgement = await judgeDetailedPlan(config, plan, safeSummary);
                     log('VERBOSE', `[JUDGE] Plan Review:\n${JSON.stringify(judgement, null, 2)}`);
                     
                     if (judgement.approved) {
                         planApproved = true;
                         plan.approved = true;
                         approvedPlan = plan;
                         judgeLog(`Plan Approved. Proceed with execution.`);
                         log('SUCCESS', `Strategy locked. Executing ${plan.tasks.length} tasks...`);
                         
                         // CRITICAL FIX: Ensure approved plan is saved to state
                         currentState = { ...currentState, currentPlan: plan };
                         updateStateCallback(group.id, currentState);
                     } else {
                         judgeLog(`Plan Rejected: ${judgement.feedback}`);
                         planFeedback = judgement.feedback;
                         planAttempts++;
                         log('WARN', 'Plan rejected by Overwatch. Revising strategy...');
                     }
                 }
                 
                 if (!approvedPlan) {
                     log('ERROR', 'Unable to formulate approved plan. Aborting agent.');
                     return { ...currentState, status: 'failed', phase: AgentPhase.FAILURE };
                 }
            }

            // 2. ACQUIRE FILE LOCK (Agent Mail Protocol)
            currentState = { ...currentState, phase: AgentPhase.ACQUIRE_LOCK };
            updateStateCallback(group.id, currentState);
            log('TOOL', `Requesting File Reservation (Lease) for: ${cleanPath}...`);
            // Simulation of lock delay
            await new Promise(r => setTimeout(r, 600)); 
            currentState = { ...currentState, fileReservations: [cleanPath] };
            updateStateCallback(group.id, currentState);
            log('SUCCESS', `Lock acquired. Exclusive edit access granted for ${cleanPath}.`);

            // 3. IMPLEMENT
            currentState = { ...currentState, phase: AgentPhase.IMPLEMENT, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            // Fetch file content - either from REPO or from PREVIOUS ITERATION (if close)
            let currentContent: CodeFile;
            
            // Fuzzy match check for persistent file recovery (handling "src/main.py" vs "main.py")
            const isSameFile = persistentFilePath && 
                               (persistentFilePath === cleanPath || 
                                persistentFilePath.endsWith(cleanPath) || 
                                cleanPath.endsWith(persistentFilePath));

            if (persistentFileContent && isSameFile) {
                currentContent = persistentFileContent;
                // FIX: Update cleanPath to the actual persistent path to maintain consistency
                cleanPath = persistentFilePath!;
                log('INFO', `Continuing implementation from previous partial fix (Using persistent state for ${cleanPath})...`);
            } else {
                try {
                    const found = await findClosestFile(config, cleanPath, headSha);
                    currentContent = found.file;
                    
                    log('VERBOSE', `[FILE] Read ${found.path} (SHA: ${found.file.sha || 'unknown'}). Size: ${found.file.content.length} chars.`);
    
                    // CRITICAL: Update cleanPath if the file was found at a different location (e.g. via fuzzy search)
                    // This ensures we verify and commit to the correct path.
                    if (found.path !== cleanPath) {
                        log('WARN', `Path correction: '${cleanPath}' -> '${found.path}'`);
                        cleanPath = found.path;
                        
                        // Reset persistent state if path changed unexpectedly to avoid contamination
                        persistentFileContent = null;
                        persistentFilePath = null;
                    }
                } catch (e: any) {
                    // [FIX] Handle 404 by allowing file creation
                    if (e.message.includes('404') || e.message.includes('not found')) {
                        log('WARN', `File ${cleanPath} not found (404). Initializing empty file for creation.`);
                        
                        // Infer language from extension
                        let inferredLang = 'txt';
                        if (cleanPath.endsWith('.yml') || cleanPath.endsWith('.yaml')) inferredLang = 'yaml';
                        else if (cleanPath.endsWith('.py')) inferredLang = 'python';
                        else if (cleanPath.endsWith('.js')) inferredLang = 'javascript';
                        else if (cleanPath.endsWith('.ts') || cleanPath.endsWith('.tsx')) inferredLang = 'typescript';
                        else if (cleanPath.endsWith('.go')) inferredLang = 'go';
                        else if (cleanPath.endsWith('.java')) inferredLang = 'java';

                        currentContent = {
                            name: cleanPath.split('/').pop() || 'new_file',
                            language: inferredLang,
                            content: "", // Empty content implies creation
                            sha: undefined
                        };
                    } else {
                        throw e; // Re-throw real errors (auth, rate limit, etc.)
                    }
                }
            }

            // --- TOOL: WEB SEARCH (If obscure error) ---
            let externalKnowledge = "";
            if (iteration > 0 || safeSummary.includes("exit code") || safeSummary.includes("unknown")) {
                const providerLabel = config.searchProvider === 'tavily' ? 'Tavily AI' : 'Google Search';
                log('TOOL', `Invoking Web Search (${providerLabel}) for solution...`);
                const searchRes = await toolWebSearch(config, safeSummary);
                externalKnowledge = `\nExternal Search Results: ${searchRes}\n`;
                log('VERBOSE', `[SEARCH] Result:\n${searchRes}`);
                log('INFO', 'External knowledge retrieved.');
            }

            // CONTEXT COMPILATION: Create focused context for implementation
            // Note: We deliberately exclude massive logs here to focus on the code artifact
            const implementationContext = compileContext(
                AgentPhase.IMPLEMENT, 
                initialRepoContext + dependencyContext, 
                safeSummary, 
                currentContent
            );
            
            log('VERBOSE', `[CTX] Implementation Context assembled (${implementationContext.length} chars).`);
            log('VERBOSE', `[IMPLEMENT] Instructions: ${safeSummary.length} chars. External Knowledge: ${externalKnowledge.length} chars.`);

            // Execute Implementation (Injecting Plan if available)
            let fixedContentStr = await generateFix(
                config, 
                currentContent, 
                safeSummary + externalKnowledge, // Pass summary directly, context handled by compileContext
                previousFeedback, 
                implementationContext,
                approvedPlan
            );
            
            log('VERBOSE', `[LLM] Generated Code (First 200 chars):\n${fixedContentStr.substring(0, 200)}...`);
            
            // --- SANITY CHECK: Output Validation ---
            const isSuspicious = fixedContentStr.includes("TodoRead") || 
                                 (currentContent.content.length > 200 && fixedContentStr.length < 50) || 
                                 (currentContent.content.length > 500 && fixedContentStr.length < currentContent.content.length * 0.4);
            
            if (isSuspicious) {
                 log('WARN', 'Agent generated suspiciously short or lazy code. Rejecting output and retrying generation...');
                 fixedContentStr = await generateFix(
                     config, 
                     currentContent, 
                     safeSummary + " CRITICAL: PREVIOUS OUTPUT WAS TRUNCATED. YOU MUST OUTPUT THE ENTIRE FILE.", 
                     "Previous output was rejected because it contained placeholders like 'TodoRead' or was incomplete.", 
                     implementationContext
                 );
            }

            // --- PRE-CHECK: Identity Check ---
            if (normalizeCode(currentContent.content) === normalizeCode(fixedContentStr)) {
                 log('VERBOSE', `[PRE-CHECK] Content identity match detected. SHA(original)=${currentContent.sha} vs Generated.`);
                 log('WARN', 'Pre-check: No changes detected. Retrying generation with strict directive...');
                 fixedContentStr = await generateFix(
                     config, 
                     currentContent, 
                     safeSummary + " CRITICAL: YOU MUST MODIFY THE CODE. DO NOT RETURN ORIGINAL FILE.", 
                     "Previous output was identical to original file. Please apply changes.", 
                     implementationContext
                 );
                 
                 if (normalizeCode(currentContent.content) === normalizeCode(fixedContentStr)) {
                      log('WARN', 'Pre-check failed again: Still no changes. Skipping Judge.');
                      previousFeedback = "Verification Pre-check Failed: You returned the exact original file twice. You must modify the code.";
                      iteration++;
                      // RELEASE LOCK ON FAILURE
                      currentState = { ...currentState, fileReservations: [] };
                      updateStateCallback(group.id, currentState);
                      log('INFO', `Releasing file lock for ${cleanPath}...`);
                      continue;
                 }
            }

            // --- TOOL: SYNTAX LINTER (Self-Correction Loop) ---
            log('TOOL', 'Running Syntax Linter (toolLintCheck)...');
            let lintResult = await toolLintCheck(config, fixedContentStr, currentContent.language);
            log('VERBOSE', `[LINT] Valid: ${lintResult.valid}. Error: ${lintResult.error || 'None'}`);
            
            if (!lintResult.valid) {
                log('WARN', `Linter found syntax error: ${lintResult.error || 'Unknown'}. Agent attempting self-correction...`);
                log('VERBOSE', `[SELF-CORRECT] Triggering re-generation due to lint error.`);
                currentState = { ...currentState, phase: AgentPhase.IMPLEMENT }; 
                updateStateCallback(group.id, currentState);
                
                fixedContentStr = await generateFix(
                    config, 
                    {...currentContent, content: fixedContentStr},
                    `Fix the following SYNTAX ERROR: ${lintResult.error}`,
                    "Previous attempt had syntax errors. Fix them while keeping the rest of the logic.",
                    implementationContext
                );
                
                lintResult = await toolLintCheck(config, fixedContentStr, currentContent.language);
                if (lintResult.valid) {
                     log('INFO', 'Self-correction successful. Syntax valid.');
                } else {
                     log('ERROR', 'Self-correction failed. Proceeding with risk of syntax error.');
                }
            } else {
                log('INFO', 'Syntax Check Passed.');
            }

            // 4. VERIFY (Judge)
            currentState = { ...currentState, phase: AgentPhase.VERIFY, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            // CONTEXT COMPILATION: Judge needs verification context
            const judgeContext = compileContext(AgentPhase.VERIFY, initialRepoContext, safeSummary);
            log('VERBOSE', `[JUDGE] Context size: ${judgeContext.length}.`);
            
            const judgeResult = await judgeFix(config, currentContent.content, fixedContentStr, safeSummary, judgeContext);
            log('VERBOSE', `[JUDGE] Code Review Result:\n${JSON.stringify(judgeResult, null, 2)}`);

            if (!judgeResult.passed) {
                // RELEASE LOCK ON JUDGE FAILURE
                currentState = { ...currentState, fileReservations: [] };
                updateStateCallback(group.id, currentState);
                log('INFO', `Releasing file lock for ${cleanPath} (Judge Failed)...`);

                if (judgeResult.score >= 8) {
                    log('WARN', `Judge Rejected but Score ${judgeResult.score}/10. Keeping partial fix for next iteration.`);
                    persistentFileContent = { ...currentContent, content: fixedContentStr };
                    persistentFilePath = cleanPath; // Track path
                    previousFeedback = `Judge Score ${judgeResult.score}/10. Reasoning: ${judgeResult.reasoning}. KEEP previous changes, but address the remaining issues.`;
                } else {
                    log('WARN', `Judge Rejected (Score ${judgeResult.score}/10). Discarding fix and reverting to original.`);
                    persistentFileContent = null;
                    persistentFilePath = null;
                    previousFeedback = `Judge Rejected (Score ${judgeResult.score}/10): ${judgeResult.reasoning}.`;
                }
                
                iteration++;
                continue; 
            }
            
            log('SUCCESS', 'Fix accepted by Judge.');
            
            // Update Agent's PRIVATE File State
            const newFileChange: FileChange = {
                path: cleanPath,
                original: currentContent,
                modified: { ...currentContent, content: fixedContentStr },
                status: 'modified'
            };

            // MERGE files state instead of overwrite
            currentState = { ...currentState, files: { ...currentState.files, [cleanPath]: newFileChange } };
            updateStateCallback(group.id, currentState);

            // 5. SANDBOX TESTING
            currentState = { ...currentState, phase: AgentPhase.TESTING, status: 'waiting' };
            updateStateCallback(group.id, currentState);
            log('INFO', 'Queueing Sandbox Verification...');

            // Run Sandbox using the AGENT'S specific files
            currentState = { ...currentState, phase: AgentPhase.TESTING, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            const testResult = await runSandboxTest(
                config, 
                group, 
                iteration, 
                true, 
                newFileChange, 
                safeSummary,
                (msg) => log('DEBUG', msg),
                currentState.files // NEW: Pass accumulated file changes
            );
            
            log('VERBOSE', `[SANDBOX] Full Result:\n${testResult.logs}`);

            // RELEASE LOCK after Sandbox
            currentState = { ...currentState, fileReservations: [] };
            updateStateCallback(group.id, currentState);
            log('INFO', `Releasing file lock for ${cleanPath} (Sandbox Complete).`);

            const testLines = testResult.logs.split('\n');
            testLines.forEach(l => {
                if (l.includes('[FAIL]')) log('ERROR', l);
                else if (l.includes('[PASS]')) log('SUCCESS', l);
            });

            if (testResult.passed) {
                currentState = { ...currentState, phase: AgentPhase.SUCCESS, status: 'success' };
                updateStateCallback(group.id, currentState);
                log('SUCCESS', 'Agent successfully verified fix.');
                return currentState; 
            } else {
                currentState = { ...currentState, phase: AgentPhase.FAILURE, status: 'failed' };
                updateStateCallback(group.id, currentState);
                log('ERROR', 'Verification Failed.');
                previousFeedback = `Sandbox Verification Failed. Logs: ${testResult.logs.substring(0, 500)}...`;
                
                // Adaptive Diagnosis: Update the logs for the next iteration to be the new failure logs
                currentLogText = testResult.logs;
                
                iteration++;
            }

        } catch (e: any) {
            // FAIL FAST: If the Run ID is 404, do not retry.
            if (currentState.phase === AgentPhase.UNDERSTAND && (e.message.includes('404') || e.message.includes('Resource not found'))) {
                log('ERROR', `Fatal: Resource not found (404) during analysis. Run ID ${group.mainRun.id} or logs may be missing. Aborting.`);
                currentState = { ...currentState, phase: AgentPhase.FAILURE, status: 'failed', fileReservations: [] };
                updateStateCallback(group.id, currentState);
                break; // Break the loop immediately
            }

            log('ERROR', `Agent Exception: ${e.message}`);
            // RELEASE LOCK ON EXCEPTION
            currentState = { ...currentState, fileReservations: [] };
            updateStateCallback(group.id, currentState);
            iteration++;
        }
    }

    // If loop finishes without success
    currentState = { ...currentState, phase: AgentPhase.FAILURE, status: 'failed' };
    updateStateCallback(group.id, currentState);
    log('ERROR', 'Agent Mission Failed after max retries.');
    return currentState;
};
