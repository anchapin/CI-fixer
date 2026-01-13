import { AppConfig, RunGroup, AgentState, LogLine, WorkflowRun } from '../types.js';
import { runIndependentAgentLoop } from '../agent.js';
import { serverServices } from '../services/server-container.js';
import { CLILogger } from '../cli/logger.js';
import { getPRFailedRuns } from '../services/github/GitHubService.js';

export interface AgentRunnerOptions {
  dryRun?: boolean;
}

/**
 * Run the agent from CLI context
 */
export async function runAgentFromCLI(
  config: AppConfig,
  logger: CLILogger,
  options: AgentRunnerOptions = {}
): Promise<AgentState> {
  // Parse repo URL
  const [owner, repo] = config.repoUrl.split('/');

  logger.info(`Processing repository: ${owner}/${repo}`);

  // Fetch workflow runs if not provided
  let selectedRuns: WorkflowRun[] = config.selectedRuns || [];

  if (selectedRuns.length === 0) {
    logger.start('Fetching failed workflow runs...');

    try {
      selectedRuns = await getPRFailedRuns(
        config.githubToken,
        owner,
        repo,
        config.prUrl || '',
        config.excludeWorkflowPatterns || []
      );

      logger.stop(`Found ${selectedRuns.length} failed runs`);
    } catch (error) {
      logger.stop();
      logger.error(`Failed to fetch workflow runs: ${(error as Error).message}`);
      throw error;
    }
  }

  if (selectedRuns.length === 0) {
    logger.warn('No failed workflow runs found. Nothing to fix.');
    return {
      groupId: 'cli-dry-run',
      name: 'CLI Fix',
      phase: 'IDLE',
      iteration: 0,
      status: 'idle',
      files: {}
    };
  }

  // Dry run mode - just validate and exit
  if (options.dryRun) {
    logger.info('Dry run mode - configuration is valid');
    logger.info(`Would process ${selectedRuns.length} failed runs:`);
    for (const run of selectedRuns) {
      logger.info(`  - Run #${run.id}: ${run.name}`);
    }
    return {
      groupId: 'cli-dry-run',
      name: 'CLI Fix (Dry Run)',
      phase: 'IDLE',
      iteration: 0,
      status: 'idle',
      files: {}
    };
  }

  // Create RunGroup
  const group: RunGroup = {
    id: `cli-${Date.now()}`,
    name: `CLI Fix: ${owner}/${repo}`,
    runIds: selectedRuns.map(r => r.id),
    mainRun: selectedRuns[0]
  };

  // Initial repo context
  const initialRepoContext = `Fixing ${owner}/${repo} - ${selectedRuns.length} failed runs`;

  // State tracking
  let currentState: AgentState = {
    groupId: group.id,
    name: group.name,
    phase: 'IDLE',
    iteration: 0,
    status: 'idle',
    files: {}
  };

  // Callbacks
  const updateCallback = (groupId: string, partial: Partial<AgentState>) => {
    currentState = { ...currentState, ...partial };
    if (partial.phase) {
      logger.onStateUpdate(partial.phase, partial.message);
    }
  };

  const logCallback = (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => {
    logger.onLog(level, content, agentName || 'Agent');
  };

  // Run agent
  logger.info(`Starting agent for ${group.name}`);
  logger.info(`Processing ${selectedRuns.length} failed workflow runs`);

  try {
    const finalState = await runIndependentAgentLoop(
      config,
      group,
      initialRepoContext,
      serverServices,
      updateCallback,
      logCallback
    );

    return finalState;
  } catch (error) {
    logger.error(`Agent failed: ${(error as Error).message}`);
    throw error;
  }
}
