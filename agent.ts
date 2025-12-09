
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
    compileContext,
    listRepoDirectory,
    toolExecuteCommand,
    generateExplorationCommands,
    generateAction
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
    let explorationLog = ""; // Store shell output

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
                
                // NEW: Publish the fetched log to the UI
                currentState = { ...currentState, activeLog: currentLogText };
                updateStateCallback(group.id, currentState);

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
                                      currentLogText.includes("Cannot find module") ||
                                      currentLogText.includes("ERR_PNPM");
                                      
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

            // --- PHASE 1.5: EXPLORE (Shell Investigation) ---
            currentState = { ...currentState, phase: AgentPhase.EXPLORE };
            updateStateCallback(group.id, currentState);
            
            // Ask Agent if it needs to explore
            log('INFO', 'Initializing Shell Environment for investigation...');
            const exploreCmds = await generateExplorationCommands(config, safeSummary, initialRepoContext + explorationLog);
            
            if (exploreCmds.length > 0) {
                log('TOOL', `Executing ${exploreCmds.length} investigation commands...`);
                for (const cmd of exploreCmds) {
                    log('VERBOSE', `[SHELL] $ ${cmd}`);
                    // PASS AGENT ID for persistent session
                    const output = await toolExecuteCommand(config, cmd, initialRepoContext, group.id);
                    log('VERBOSE', `[SHELL] > ${output.substring(0, 100).replace(/\n/g, ' ')}...`);
                    explorationLog += `\n$ ${cmd}\n${output}\n`;
                }
                // Refine diagnosis with new info
                log('INFO', 'Exploration complete. Refining context...');
            } else {
                log('INFO', 'Agent skipped active exploration (Confidence High).');
            }

            // Fix: enhanced path cleaning to handle ./src prefix
            let cleanPath = diagnosis.filePath ? diagnosis.filePath.replace(/^(\.\/|\/)+/, '') : '';
            
            // NEW: Override for Lockfile Errors (ZeroOperator Fix)
            const lowerSummary = safeSummary.toLowerCase();
            if (lowerSummary.includes('frozen-lockfile') || lowerSummary.includes('lockfile is absent') || lowerSummary.includes('err_pnpm_no_lockfile')) {
                log('WARN', `Missing Lockfile detected. Targeting package.json to potentially adjust scripts or versions.`);
                cleanPath = 'package.json';
            } else if (cleanPath) {
                 // CyberSentinel Fix: Trust Diagnosis, but Verify Cross-Stack
                 const isPythonError = lowerSummary.includes('python') || lowerSummary.includes('pip') || safeSummary.includes('.py');
                 const isNodeError = lowerSummary.includes('npm') || lowerSummary.includes('node') || lowerSummary.includes('typescript') || lowerSummary.includes('react');
                 
                 const p = cleanPath.toLowerCase();
                 const isPythonFile = p.endsWith('.py');
                 const isNodeFile = p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx');

                 if (isPythonError && isNodeFile) {
                      log('WARN', `Diagnosis Mismatch: Error implies Python but target is ${cleanPath} (Node). Discarding target and invoking search.`);
                      cleanPath = ''; // Force search
                 } else if (isNodeError && isPythonFile) {
                      log('WARN', `Diagnosis Mismatch: Error implies Node but target is ${cleanPath} (Python). Discarding target and invoking search.`);
                      cleanPath = ''; // Force search
                 }
            }
            
            // Track search results for fallback logic
            let searchResults: string[] = [];

            // --- TOOL: CODE SEARCH & RESOLUTION ---
            if (!cleanPath || cleanPath === 'unknown' || cleanPath === '') {
                 currentState = { ...currentState, phase: AgentPhase.TOOL_USE };
                 updateStateCallback(group.id, currentState);
                 
                 // IMPROVEMENT: Smart Missing File Detection
                 // Regex to catch "No such file: 'requirements.txt'" or similar patterns in the summary
                 const missingFileMatch = safeSummary.match(/(?:no such file|not found|missing).*?['"`]([^'"`\s]+\.[a-zA-Z0-9]+)['"`]/i);
                 
                 if (missingFileMatch && missingFileMatch[1]) {
                     const missingCandidate = missingFileMatch[1];
                     log('TOOL', `Diagnosis implies missing file: '${missingCandidate}'. Searching for existing locations...`);
                     
                     // Search specifically for this filename
                     searchResults = await toolCodeSearch(config, `filename:${missingCandidate}`);
                     
                     if (searchResults.length === 0) {
                         // If not found in repo, we MUST create it or fix the workflow.
                         // Do NOT fuzzy search for random error words.
                         cleanPath = missingCandidate;
                         log('INFO', `File '${cleanPath}' appears to be completely missing from repo. Agent will target it for creation.`);
                     } else {
                         // If found elsewhere, maybe the path in workflow is wrong
                         cleanPath = searchResults[0];
                         log('INFO', `Found '${missingCandidate}' at '${cleanPath}'. Targeting this file.`);
                     }
                 } else {
                     // Fallback: Generic Context Search
                     log('TOOL', `Invoking Code Search for error context...`);
                     // Use a shorter, more keyword-focused query
                     const query = safeSummary.replace(/[^\w\s.]/g, '').split(' ').filter(w => w.length > 4).slice(0, 4).join(' ');
                     searchResults = await toolCodeSearch(config, query || safeSummary.substring(0, 30));
                     log('VERBOSE', `[TOOL:CodeSearch] Results: ${JSON.stringify(searchResults)}`);
                 }

                 // IMPROVEMENT: Cross-Stack Contamination Guard
                 if (!cleanPath && searchResults.length > 0) {
                     const isPythonError = lowerSummary.includes('python') || lowerSummary.includes('pip') || safeSummary.includes('.py');
                     const isNodeError = lowerSummary.includes('npm') || lowerSummary.includes('node') || lowerSummary.includes('typescript') || lowerSummary.includes('react') || safeSummary.includes('.ts') || safeSummary.includes('.js');
                     
                     const filteredResults = searchResults.filter(f => {
                         const fLower = f.toLowerCase();
                         if (isPythonError) {
                             // If python error, reject TS/JS/React files
                             return !fLower.endsWith('.tsx') && !fLower.endsWith('.ts') && !fLower.endsWith('.js') && !fLower.endsWith('.jsx');
                         }
                         if (isNodeError) {
                             // If node error, reject Python files
                             return !fLower.endsWith('.py');
                         }
                         return true;
                     });

                     if (filteredResults.length > 0) {
                         cleanPath = filteredResults[0];
                         log('INFO', `Selected relevant file (Stack-Verified): ${cleanPath}`);
                     } else {
                         log('WARN', `Search results rejected due to Cross-Stack Mismatch (e.g. Python error vs TSX file). Falling back to Infrastructure Config.`);
                         // Leave cleanPath empty to trigger the infrastructure fallback below
                     }
                 }
            }

            // --- LOGIC: Directory Resolution ---
            if (cleanPath.endsWith('/') || cleanPath === '.github/workflows' || cleanPath === '.github/workflows/') {
                 log('INFO', `Path '${cleanPath}' is a directory. Resolving to specific workflow file...`);
                 try {
                     const dirFiles = await listRepoDirectory(config, cleanPath, headSha);
                     const ymlFile = dirFiles.find(f => f.name.endsWith('.yml') || f.name.endsWith('.yaml'));
                     if (ymlFile) {
                         cleanPath = ymlFile.path;
                         log('INFO', `Resolved directory to: ${cleanPath}`);
                     } else if (dirFiles.length > 0) {
                         cleanPath = dirFiles[0].path;
                         log('WARN', `No YAML found in directory. Defaulting to first file: ${cleanPath}`);
                     }
                 } catch (e) {
                     log('WARN', `Failed to list directory ${cleanPath}. Keeping original path.`);
                 }
            }

            if (!cleanPath) {
                // NEW: Handle System/Infrastructure Errors (e.g. Disk Space)
                if (lowerSummary.includes('no space left') || lowerSummary.includes('oserror') || lowerSummary.includes('errno 28')) {
                    cleanPath = group.mainRun.path || '.github/workflows/ci.yml';
                    log('WARN', `Infrastructure error detected. Targeting workflow file: ${cleanPath}`);
                }
                // NEW: Handle Lockfile / Dependency Errors (Fallback)
                else if (lowerSummary.includes('lockfile') || lowerSummary.includes('err_pnpm') || lowerSummary.includes('frozen-lockfile')) {
                    log('INFO', `Dependency/Lockfile error detected (Fallback). Targeting package configuration.`);
                    // 1. Try to find the relevant package.json
                    const packageJson = searchResults.find(f => f.endsWith('package.json'));
                    // 2. Or try to find the CI workflow to disable frozen-lockfile
                    const workflowFile = searchResults.find(f => f.includes('.github/workflows'));

                    cleanPath = packageJson || workflowFile || 'package.json';
                }
                // Context-aware fallback logic
                else if (lowerSummary.includes('workflow') || lowerSummary.includes('action') || lowerSummary.includes('yaml')) {
                    cleanPath = '.github/workflows/main.yml'; // Better guess for CI errors
                } else if (lowerSummary.includes('pnpm') || lowerSummary.includes('npm') || lowerSummary.includes('node') || lowerSummary.includes('dependency')) {
                    cleanPath = 'package.json';
                } else if (lowerSummary.includes('python') || lowerSummary.includes('pip') || lowerSummary.includes('requirements')) {
                    cleanPath = 'requirements.txt'; // Default for python missing deps
                } else {
                    cleanPath = 'docker-compose.yml'; 
                }
                log('WARN', `Path remains ambiguous. Defaulting to Infrastructure file: ${cleanPath}`);
            }
            log('DEBUG', `Diagnosis Target: ${safeSummary} in ${cleanPath}`);

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
                     
                     const plan = await generateDetailedPlan(config, safeSummary, planFeedback, planningContext);
                     log('VERBOSE', `[PLAN] Generated Plan:\n${JSON.stringify(plan, null, 2)}`);
                     
                     // --- SAFEGUARD: Malformed Plan Check ---
                     if (!plan || !Array.isArray(plan.tasks)) {
                         log('WARN', 'LLM returned a malformed plan (missing tasks). Fallback to manual strategy.');
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
                     
                     // Judge Plan (Updated to respect pre-approved plans)
                     let judgement = { approved: plan.approved, feedback: "Pre-approved strategy." };
                     
                     if (!plan.approved) {
                         judgeLog(`Reviewing Agent Strategy: "${plan.goal}"...`);
                         
                         // HEURISTIC GUARDRAIL: Auto-reject lazy "investigation" plans if logs are clear
                         const isGenericPlan = plan.goal.toLowerCase().includes("investigate") || plan.goal.toLowerCase().includes("add logging");
                         const lowerLogs = currentLogText.toLowerCase();
                         const logsShowClearError = lowerLogs.includes("no space left") || 
                                                  lowerLogs.includes("no such file") || 
                                                  lowerLogs.includes("modulenotfound") ||
                                                  lowerLogs.includes("importerror");

                         if (isGenericPlan && logsShowClearError) {
                             log('WARN', `[JUDGE-AUTO] Rejected generic investigation plan because logs contain specific errors.`);
                             judgement = { 
                                 approved: false, 
                                 feedback: "AUTO-REJECTION: The logs contain a clear specific error (e.g. Missing File, Disk Space, Import). Do not 'investigate' or 'add logging'. Fix the specific error shown in the logs." 
                             };
                         } else {
                             // Call LLM Judge with Context
                             judgement = await judgeDetailedPlan(config, plan, safeSummary, currentLogText);
                         }

                         log('VERBOSE', `[JUDGE] Plan Review:\n${JSON.stringify(judgement, null, 2)}`);
                     } else {
                         log('WARN', `Plan pre-approved (Emergency/Fallback Mode). Skipping Judge.`);
                     }
                     
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

            // 3. DECIDE ACTION TYPE (Command vs Edit)
            currentState = { ...currentState, phase: AgentPhase.IMPLEMENT, status: 'working' };
            updateStateCallback(group.id, currentState);

            const planContext = approvedPlan ? JSON.stringify(approvedPlan) : safeSummary;
            const actionDecision = await generateAction(config, approvedPlan || { goal: safeSummary, tasks: [], approved: true }, initialRepoContext);
            
            // Branch 1: Shell Command Fix (e.g. "npm install")
            if (actionDecision.type === 'command' && actionDecision.command) {
                log('INFO', `Selected Action: SHELL EXECUTION. Running: ${actionDecision.command}`);
                // PASS AGENT ID for persistent session
                const cmdOutput = await toolExecuteCommand(config, actionDecision.command, initialRepoContext, group.id);
                log('VERBOSE', `[SHELL] Output:\n${cmdOutput}`);
                
                // If it was a fix command, we might be done. 
                // We'll proceed to VERIFY phase immediately, treating the shell output as the "fix artifact".
                // Note: We don't acquire file locks for shell commands usually, unless we want to block the repo.
                log('SUCCESS', 'Command executed. Proceeding to Verification.');
                
                // Hack: We populate currentContent with a dummy value to satisfy the interface downstream if needed,
                // or we just skip the code generation block.
                // For now, let's jump to verification.
            } 
            
            // Branch 2: File Edit Fix (Standard Path)
            else {
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
            } // End of File Edit Branch

            // 5. SANDBOX TESTING
            currentState = { ...currentState, phase: AgentPhase.TESTING, status: 'waiting' };
            updateStateCallback(group.id, currentState);
            log('INFO', 'Queueing Sandbox Verification...');

            // Run Sandbox using the AGENT'S specific files
            currentState = { ...currentState, phase: AgentPhase.TESTING, status: 'working' };
            updateStateCallback(group.id, currentState);
            
            // Note: For shell commands, we don't necessarily have a "FileChange" object.
            // We pass the latest state.
            const testResult = await runSandboxTest(
                config, 
                group, 
                iteration, 
                true, 
                actionDecision.type === 'edit' ? currentState.files[cleanPath] : undefined, // Only pass change if edit
                safeSummary,
                (msg) => log('DEBUG', msg),
                currentState.files 
            );
            
            log('VERBOSE', `[SANDBOX] Full Result:\n${testResult.logs}`);

            // RELEASE LOCK after Sandbox
            currentState = { ...currentState, fileReservations: [] };
            updateStateCallback(group.id, currentState);
            if (actionDecision.type === 'edit') log('INFO', `Releasing file lock for ${cleanPath} (Sandbox Complete).`);

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
                // NEW: Publish the new failure logs to the UI
                currentState = { ...currentState, activeLog: currentLogText };
                updateStateCallback(group.id, currentState);

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