
import { prepareSandbox } from '../services.js';
import { runWorkerTask } from './worker.js';
import { SandboxEnvironment, SimulationSandbox } from '../sandbox.js';
import { AppConfig, RunGroup, AgentState, LogLine } from '../types.js';

export async function runSupervisorAgent(
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {

    let sandbox: SandboxEnvironment | undefined;

    try {
        // 1. Initialize Sandbox (Persistent or Simulation)
        try {
            logCallback('INFO', 'Initializing Supervisor Environment (Shared Sandbox)...', group.id, group.name);
            const sha = group.mainRun.head_sha || undefined;
            sandbox = await prepareSandbox(config, config.repoUrl, sha);
            logCallback('SUCCESS', `Sandbox Ready (${sandbox.getId()}).`, group.id, group.name);
        } catch (e: any) {
            logCallback('ERROR', `Sandbox Init Failed: ${e.message}. Falling back to Simulation.`, group.id, group.name);
            sandbox = new SimulationSandbox();
            await sandbox.init();
            config.devEnv = 'simulation';
        }

        // 2. Delegate to Worker (Centralized Coordination)
        // In the future, this Supervisor can plan sub-tasks and spawn multiple workers.
        // For now, it delegates the entire goal to a single worker.
        logCallback('INFO', 'Spawning Worker Agent...', group.id, group.name);

        const result = await runWorkerTask(
            config,
            group,
            sandbox,
            initialRepoContext,
            updateStateCallback,
            logCallback
        );

        return result;

    } catch (error: any) {
        logCallback('ERROR', `Supervisor crashed: ${error.message}`, group.id, group.name);
        throw error;
    } finally {
        if (sandbox) {
            try {
                await sandbox.teardown();
                logCallback('INFO', 'Supervisor cleaned up shared sandbox.', group.id, group.name);
            } catch (e) {
                console.warn("Failed to kill shared sandbox", e);
            }
        }
    }
}
