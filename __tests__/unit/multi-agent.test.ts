import { describe, it, expect, beforeEach } from 'vitest';
import { MultiAgentCoordinator, AgentTask, detectIndependentErrors } from '../../services/multi-agent/coordinator.js';

describe('Multi-Agent Collaboration', () => {
    let coordinator: MultiAgentCoordinator;

    beforeEach(() => {
        coordinator = new MultiAgentCoordinator();
    });

    describe('Coordinator', () => {
        it('should initialize with agents', () => {
            const stats = coordinator.getStats();

            expect(stats.totalAgents).toBeGreaterThan(0);
            expect(stats.agentsByRole.analyzer).toBeGreaterThan(0);
            expect(stats.agentsByRole.fixer).toBeGreaterThan(0);
            expect(stats.agentsByRole.validator).toBeGreaterThan(0);
        });

        it('should add tasks to queue', () => {
            const task: AgentTask = {
                id: 'task-1',
                errorId: 'error-1',
                role: 'analyzer',
                priority: 1,
                dependencies: [],
                status: 'pending'
            };

            coordinator.addTask(task);

            const stats = coordinator.getStats();
            expect(stats.totalTasks).toBe(1);
        });

        it('should execute tasks', async () => {
            const task1: AgentTask = {
                id: 'task-1',
                errorId: 'error-1',
                role: 'analyzer',
                priority: 1,
                dependencies: [],
                status: 'pending'
            };

            const task2: AgentTask = {
                id: 'task-2',
                errorId: 'error-1',
                role: 'fixer',
                priority: 2,
                dependencies: ['task-1'],
                status: 'pending'
            };

            coordinator.addTask(task1);
            coordinator.addTask(task2);

            const result = await coordinator.executeTasks();

            expect(result.success).toBe(true);
            expect(result.tasksCompleted).toBe(2);
        });

        it('should execute independent tasks in parallel', async () => {
            const task1: AgentTask = {
                id: 'task-1',
                errorId: 'error-1',
                role: 'fixer',
                priority: 1,
                dependencies: [],
                status: 'pending'
            };

            const task2: AgentTask = {
                id: 'task-2',
                errorId: 'error-2',
                role: 'fixer',
                priority: 1,
                dependencies: [],
                status: 'pending'
            };

            coordinator.addTask(task1);
            coordinator.addTask(task2);

            const result = await coordinator.executeTasks();

            expect(result.success).toBe(true);
            expect(result.parallelExecutions).toBeGreaterThan(0);
        });

        it('should track agent utilization', async () => {
            const task: AgentTask = {
                id: 'task-1',
                errorId: 'error-1',
                role: 'analyzer',
                priority: 1,
                dependencies: [],
                status: 'pending'
            };

            coordinator.addTask(task);
            const result = await coordinator.executeTasks();

            expect(result.agentUtilization).toBeDefined();
            expect(Object.keys(result.agentUtilization).length).toBeGreaterThan(0);
        });
    });

    describe('Independent Error Detection', () => {
        it('should detect independent errors', () => {
            const errors = [
                { id: 'e1', affectedFiles: ['file1.ts'] },
                { id: 'e2', affectedFiles: ['file2.ts'] },
                { id: 'e3', affectedFiles: ['file1.ts'] }
            ];

            const groups = detectIndependentErrors(errors);

            // e1 and e3 should be grouped (same file)
            // e2 should be separate
            expect(groups.length).toBe(2);
        });

        it('should handle all independent errors', () => {
            const errors = [
                { id: 'e1', affectedFiles: ['file1.ts'] },
                { id: 'e2', affectedFiles: ['file2.ts'] },
                { id: 'e3', affectedFiles: ['file3.ts'] }
            ];

            const groups = detectIndependentErrors(errors);

            // All independent
            expect(groups.length).toBe(3);
            expect(groups.every(g => g.length === 1)).toBe(true);
        });

        it('should handle all dependent errors', () => {
            const errors = [
                { id: 'e1', affectedFiles: ['file1.ts'] },
                { id: 'e2', affectedFiles: ['file1.ts'] },
                { id: 'e3', affectedFiles: ['file1.ts'] }
            ];

            const groups = detectIndependentErrors(errors);

            // All dependent (same file)
            expect(groups.length).toBe(1);
            expect(groups[0].length).toBe(3);
        });
    });
});
