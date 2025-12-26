
import { prepareSandbox } from '../services/sandbox/SandboxService.js';
import { runGraphAgent } from './graph/coordinator.js';
import { SandboxEnvironment, SimulationSandbox } from '../sandbox.js';
import { AppConfig, RunGroup, AgentState, LogLine } from '../types.js';
import { analyzeRepository, formatProfileSummary, type RepositoryProfile } from '../validation.js';

import { ServiceContainer } from '../services/container.js';

export async function runSupervisorAgent(
    config: AppConfig,
    group: RunGroup,
    initialRepoContext: string,
    services: ServiceContainer,
    updateStateCallback: (groupId: string, state: Partial<AgentState>) => void,
    logCallback: (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => void
): Promise<AgentState> {

    let sandbox: SandboxEnvironment | undefined;
    let profile: RepositoryProfile | undefined;

    try {
        // 1. Initialize Sandbox (Persistent or Simulation)
        try {
            logCallback('INFO', 'Initializing Supervisor Environment (Shared Sandbox)...', group.id, group.name);
            const sha = group.mainRun.head_sha || undefined;
            sandbox = await services.sandbox.prepareSandbox(config, config.repoUrl, sha, (phase, msg) => {
                logCallback(phase as any, msg, group.id, group.name);
            });
            logCallback('SUCCESS', `Sandbox Ready (${sandbox.getId()}).`, group.id, group.name);
        } catch (e: any) {
            logCallback('ERROR', `Sandbox Init Failed: ${e.message}. Falling back to Simulation.`, group.id, group.name);
            sandbox = new SimulationSandbox();
            await sandbox.init();
            config.devEnv = 'simulation';
        }

        // 2. Profile Repository (for context-aware decisions)
        try {
            logCallback('INFO', 'Profiling repository structure...', group.id, group.name);
            const [owner, repo] = config.repoUrl.split('/').slice(-2);
            const sha = group.mainRun.head_sha || 'main'; // Fix shadowing of sha if needed
            profile = await analyzeRepository(owner, repo, sha, config.githubToken);

            const summary = formatProfileSummary(profile);
            logCallback('INFO', `Repository Profile:\n${summary}`, group.id, group.name);
        } catch (e: any) {
            logCallback('WARN', `Repository profiling failed: ${e.message}. Proceeding without profile.`, group.id, group.name);
            profile = undefined; // Graceful degradation
        }

        // 3. Delegate to Graph Agent
        logCallback('INFO', 'Spawning Graph Agent...', group.id, group.name);

        const result = await runGraphAgent(
            config,
            group,
            sandbox,
            profile,
            initialRepoContext,
            services,
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
