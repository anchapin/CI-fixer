import { AppConfig, WorkflowRun, RunGroup } from '../../types';

export async function groupFailedRuns(config: AppConfig, runs: WorkflowRun[]): Promise<RunGroup[]> {
    const groups: Record<string, RunGroup> = {};

    runs.forEach(run => {
        if (!groups[run.name]) {
            groups[run.name] = {
                id: `GROUP-${Math.random().toString(36).substr(2, 5)}`,
                name: run.name,
                runIds: [],
                mainRun: run
            };
        }
        groups[run.name].runIds.push(run.id);
    });

    return Object.values(groups);
}

export async function generateRepoSummary(config: AppConfig): Promise<string> {
    return "Repository Context: (Simulation Mode - No Access)";
}
