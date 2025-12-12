
import { runSupervisorAgent } from './agent/supervisor.js';
import { AppConfig, RunGroup, AgentState, LogLine } from './types.js';

export async function runIndependentAgentLoop(
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {
    // Facade: Delegate to the Supervisor-Worker Architecture
    return runSupervisorAgent(config, group, initialRepoContext, updateStateCallback, logCallback);
}
