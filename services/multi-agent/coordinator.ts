/**
 * Multi-Agent Collaboration Module
 * Implements LANTERN-inspired multi-agent system for parallel error fixing
 * Based on "LANTERN: Multi-Agent Debugging" research
 */

export type AgentRole = 'analyzer' | 'fixer' | 'validator' | 'coordinator';

export interface AgentTask {
    id: string;
    errorId: string;
    role: AgentRole;
    priority: number;
    dependencies: string[];
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: any;
}

export interface Agent {
    id: string;
    role: AgentRole;
    capabilities: string[];
    currentTask?: AgentTask;
    completedTasks: number;
}

export interface CollaborationResult {
    success: boolean;
    tasksCompleted: number;
    parallelExecutions: number;
    totalTime: number;
    agentUtilization: Record<string, number>;
}

/**
 * Multi-Agent Coordinator
 */
export class MultiAgentCoordinator {
    private agents: Map<string, Agent> = new Map();
    private tasks: Map<string, AgentTask> = new Map();
    private taskQueue: AgentTask[] = [];

    constructor() {
        // Initialize specialized agents
        this.createAgent('analyzer-1', 'analyzer', ['error-classification', 'root-cause-analysis']);
        this.createAgent('fixer-1', 'fixer', ['code-generation', 'patch-application']);
        this.createAgent('fixer-2', 'fixer', ['code-generation', 'patch-application']);
        this.createAgent('validator-1', 'validator', ['test-execution', 'verification']);
        this.createAgent('coordinator-1', 'coordinator', ['task-scheduling', 'dependency-resolution']);
    }

    /**
     * Create a new agent
     */
    private createAgent(id: string, role: AgentRole, capabilities: string[]): void {
        this.agents.set(id, {
            id,
            role,
            capabilities,
            completedTasks: 0
        });
    }

    /**
     * Add task to queue
     */
    addTask(task: AgentTask): void {
        this.tasks.set(task.id, task);
        this.taskQueue.push(task);
    }

    /**
     * Execute tasks in parallel
     */
    async executeTasks(): Promise<CollaborationResult> {
        const startTime = Date.now();
        let parallelExecutions = 0;

        // Sort tasks by priority and dependencies
        const sortedTasks = this.topologicalSort(this.taskQueue);

        // Execute tasks in waves (parallel where possible)
        const waves = this.groupIntoWaves(sortedTasks);

        for (const wave of waves) {
            if (wave.length > 1) {
                parallelExecutions++;
            }

            // Execute wave in parallel
            await Promise.all(wave.map(task => this.executeTask(task)));
        }

        const totalTime = Date.now() - startTime;

        // Calculate agent utilization
        const utilization: Record<string, number> = {};
        for (const [id, agent] of this.agents) {
            utilization[id] = agent.completedTasks;
        }

        return {
            success: true,
            tasksCompleted: this.taskQueue.length,
            parallelExecutions,
            totalTime,
            agentUtilization: utilization
        };
    }

    /**
     * Execute a single task
     */
    private async executeTask(task: AgentTask): Promise<void> {
        // Find available agent with matching role
        const agent = this.findAvailableAgent(task.role);

        if (!agent) {
            task.status = 'failed';
            return;
        }

        // Assign task to agent
        agent.currentTask = task;
        task.status = 'running';

        // Simulate task execution
        await this.simulateWork(task);

        // Complete task
        task.status = 'completed';
        agent.completedTasks++;
        agent.currentTask = undefined;
    }

    /**
     * Find available agent for role
     */
    private findAvailableAgent(role: AgentRole): Agent | undefined {
        for (const agent of this.agents.values()) {
            if (agent.role === role && !agent.currentTask) {
                return agent;
            }
        }
        return undefined;
    }

    /**
     * Topological sort for dependency resolution
     */
    private topologicalSort(tasks: AgentTask[]): AgentTask[] {
        const sorted: AgentTask[] = [];
        const visited = new Set<string>();
        const temp = new Set<string>();

        const visit = (task: AgentTask) => {
            if (temp.has(task.id)) {
                throw new Error('Circular dependency detected');
            }
            if (visited.has(task.id)) {
                return;
            }

            temp.add(task.id);

            for (const depId of task.dependencies) {
                const depTask = this.tasks.get(depId);
                if (depTask) {
                    visit(depTask);
                }
            }

            temp.delete(task.id);
            visited.add(task.id);
            sorted.push(task);
        };

        for (const task of tasks) {
            if (!visited.has(task.id)) {
                visit(task);
            }
        }

        return sorted;
    }

    /**
     * Group tasks into parallel execution waves
     */
    private groupIntoWaves(tasks: AgentTask[]): AgentTask[][] {
        const waves: AgentTask[][] = [];
        const completed = new Set<string>();

        while (completed.size < tasks.length) {
            const wave: AgentTask[] = [];

            for (const task of tasks) {
                if (completed.has(task.id)) continue;

                // Check if all dependencies are completed
                const depsCompleted = task.dependencies.every(dep => completed.has(dep));

                if (depsCompleted) {
                    wave.push(task);
                    completed.add(task.id);
                }
            }

            if (wave.length === 0) break; // No more tasks can be executed
            waves.push(wave);
        }

        return waves;
    }

    /**
     * Simulate task execution
     */
    private async simulateWork(task: AgentTask): Promise<void> {
        // Simulate async work
        return new Promise(resolve => {
            setTimeout(resolve, 10); // 10ms simulated work
        });
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalAgents: number;
        totalTasks: number;
        completedTasks: number;
        agentsByRole: Record<AgentRole, number>;
    } {
        const agentsByRole: Record<AgentRole, number> = {
            analyzer: 0,
            fixer: 0,
            validator: 0,
            coordinator: 0
        };

        for (const agent of this.agents.values()) {
            agentsByRole[agent.role]++;
        }

        const completedTasks = Array.from(this.tasks.values())
            .filter(t => t.status === 'completed').length;

        return {
            totalAgents: this.agents.size,
            totalTasks: this.tasks.size,
            completedTasks,
            agentsByRole
        };
    }
}

/**
 * Detect independent errors for parallel execution
 */
export function detectIndependentErrors(
    errors: Array<{ id: string; affectedFiles: string[] }>
): Array<string[]> {
    const groups: Array<string[]> = [];
    const processed = new Set<string>();

    for (const error of errors) {
        if (processed.has(error.id)) continue;

        const group = [error.id];
        processed.add(error.id);

        // Find errors with overlapping files (dependent)
        for (const other of errors) {
            if (processed.has(other.id)) continue;

            const hasOverlap = error.affectedFiles.some(f =>
                other.affectedFiles.includes(f)
            );

            if (hasOverlap) {
                group.push(other.id);
                processed.add(other.id);
            }
        }

        groups.push(group);
    }

    return groups;
}

/**
 * Global multi-agent coordinator instance
 */
let globalCoordinator: MultiAgentCoordinator | null = null;

export function getMultiAgentCoordinator(): MultiAgentCoordinator {
    if (!globalCoordinator) {
        globalCoordinator = new MultiAgentCoordinator();
    }
    return globalCoordinator;
}
