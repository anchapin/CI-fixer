
import { AppConfig, RunGroup, AgentPhase, AgentState, LogLine, FileChange } from './types';
import { 
    getWorkflowLogs, toolScanDependencies, diagnoseError, 
    findClosestFile, toolCodeSearch, generateDetailedPlan, 
    toolWebSearch, generateFix, toolLintCheck, judgeFix, runSandboxTest
} from './services';

export async function runIndependentAgentLoop(
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {
    
    const MAX_ITERATIONS = 3;
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
        updateStateCallback(group.id, currentState);
        log('INFO', `Starting analysis for workflow: ${group.name}`);

        const { logText, headSha } = await getWorkflowLogs(config.repoUrl, group.runIds[0], config.githubToken);
        const currentLogText = logText;

        let dependencyContext = "";
        const isDependencyIssue = currentLogText.includes("ModuleNotFoundError") || 
                                  currentLogText.includes("ImportError") || 
                                  currentLogText.includes("No module named") || 
                                  currentLogText.includes("Missing dependency");
                                  
        if (isDependencyIssue) {
             currentState.phase = AgentPhase.TOOL_USE;
             updateStateCallback(group.id, currentState);
             log('TOOL', 'Invoking Dependency Inspector...');
             const depReport = await toolScanDependencies(config, headSha);
             dependencyContext = `\nDEPENDENCY REPORT:\n${depReport}\n`;
             log('VERBOSE', `Dependency Report generated.`);
        }

        currentState.phase = AgentPhase.UNDERSTAND;
        updateStateCallback(group.id, currentState);
        
        let diagnosis = await diagnoseError(config, currentLogText, initialRepoContext + dependencyContext);
        
        // Handle ambiguous diagnosis that might cause crashes later
        if (!diagnosis.filePath && diagnosis.summary.includes("Unknown")) {
             log('WARN', 'Diagnosis ambiguous. Attempting heuristic search...');
             diagnosis.filePath = ""; // Reset to allow search
        }
        
        log('INFO', `Diagnosis: ${diagnosis.summary} in ${diagnosis.filePath}`);

        currentState.phase = AgentPhase.EXPLORE;
        updateStateCallback(group.id, currentState);

        let targetFile = await findClosestFile(config, diagnosis.filePath);
        if (!targetFile) {
            log('WARN', `File '${diagnosis.filePath}' not found. Searching repo...`);
            
            // Fallback: If filePath is empty (from bad diagnosis) or just not found, 
            // search using the Summary keywords, ensuring we don't pass null/empty
            const query = (diagnosis.filePath && diagnosis.filePath.length > 2) ? diagnosis.filePath : diagnosis.summary;
            const searchResults = await toolCodeSearch(config, query);
            
            if (searchResults.length > 0) {
                 log('INFO', `Search found potential match: ${searchResults[0]}`);
                 targetFile = await findClosestFile(config, searchResults[0]);
            }
        }

        if (!targetFile) {
            // "Create File" Fallback (CrimsonArchitect fix)
            // If we still don't have a file, and the error implies it's missing, create a virtual one.
            if (diagnosis.summary.toLowerCase().includes("no such file") || 
                diagnosis.summary.toLowerCase().includes("not found") ||
                diagnosis.summary.toLowerCase().includes("missing")) {
                
                log('INFO', `Target file missing. Initializing CREATE mode for: ${diagnosis.filePath || 'new_file'}`);
                targetFile = {
                    path: diagnosis.filePath || 'new_file.txt',
                    file: {
                        name: diagnosis.filePath?.split('/').pop() || 'new_file.txt',
                        language: 'text', // Agent can refine this later
                        content: "" // Empty content for new file
                    }
                };
            } else {
                throw new Error(`Could not locate source file for error: ${diagnosis.summary}`);
            }
        }
        
        currentState.phase = AgentPhase.PLAN;
        updateStateCallback(group.id, currentState);
        
        // Just gen plan, ignoring result for simplicity in this flow, assuming automatic approval
        await generateDetailedPlan(config, diagnosis.summary, targetFile.path);
        
        currentState.phase = AgentPhase.ACQUIRE_LOCK;
        currentState.fileReservations = [targetFile.path];
        updateStateCallback(group.id, currentState);
        log('INFO', `Acquired lock on ${targetFile.path}`);

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            currentState.iteration = i;
            updateStateCallback(group.id, currentState);

            currentState.phase = AgentPhase.IMPLEMENT;
            updateStateCallback(group.id, currentState);

            let extraContext = "";
            if (i > 0) {
                log('TOOL', 'Searching web for solutions...');
                const webResult = await toolWebSearch(config, diagnosis.summary);
                extraContext = `\nWEB SEARCH RESULTS:\n${webResult}`;
            }

            const fixCode = await generateFix(config, { 
                code: targetFile.file.content, 
                error: diagnosis.summary, 
                language: targetFile.file.language,
                extraContext 
            });

            const lintResult = await toolLintCheck(config, fixCode, targetFile.file.language);
            if (!lintResult.valid) {
                log('WARN', `Lint check failed: ${lintResult.error}. Attempting self-correction...`);
            }

            const fileChange: FileChange = {
                path: targetFile.path,
                original: targetFile.file,
                modified: { ...targetFile.file, content: fixCode },
                status: 'modified'
            };
            currentState.files[targetFile.path] = fileChange;
            updateStateCallback(group.id, currentState);

            currentState.phase = AgentPhase.VERIFY;
            updateStateCallback(group.id, currentState);

            const judgeResult = await judgeFix(config, targetFile.file.content, fixCode, diagnosis.summary);
            log('INFO', `Judge Score: ${judgeResult.score}/10. ${judgeResult.reasoning}`);

            if (judgeResult.passed) {
                currentState.phase = AgentPhase.TESTING;
                updateStateCallback(group.id, currentState);
                
                const testResult = await runSandboxTest(config, group, i, true, fileChange, diagnosis.summary, logCallback, currentState.files);
                
                if (testResult.passed) {
                    currentState.status = 'success';
                    currentState.phase = AgentPhase.SUCCESS;
                    currentState.message = "Fix verified successfully.";
                    currentState.fileReservations = []; 
                    updateStateCallback(group.id, currentState);
                    log('SUCCESS', `Agent ${group.name} succeeded.`);
                    return currentState;
                } else {
                    log('WARN', `Sandbox Test Failed: ${testResult.logs.substring(0, 100)}...`);
                }
            }
            
            log('WARN', `Iteration ${i} failed. Retrying...`);
        }

        currentState.status = 'failed';
        currentState.phase = AgentPhase.FAILURE;
        currentState.fileReservations = []; 
        updateStateCallback(group.id, currentState);
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
