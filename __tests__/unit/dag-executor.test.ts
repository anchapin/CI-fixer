import { describe, it, expect } from 'vitest';
import {
    getExecutableNodes,
    getNextNode,
    isDAGComplete,
    markNodeSolved,
    getDAGProgress,
    describeDAGPlan
} from '../../services/dag-executor.js';
import { ErrorDAG, ErrorNode } from '../../types.js';
import { GraphState } from '../../agent/graph/state.js';

// Helper to create test DAG
function createTestDAG(): ErrorDAG {
    return {
        nodes: [
            { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
            { id: 'B', problem: 'Fix B', category: 'DEPENDENCY', affectedFiles: [], dependencies: [], priority: 1, complexity: 3 },
            { id: 'C', problem: 'Fix C', category: 'CONFIG', affectedFiles: [], dependencies: ['B'], priority: 2, complexity: 2 }
        ],
        edges: [{ from: 'B', to: 'C' }],
        rootProblem: 'Multi-error scenario'
    };
}

describe('DAG Executor', () => {
    describe('getExecutableNodes', () => {
        it('should return all nodes with no dependencies when nothing is solved', () => {
            const dag = createTestDAG();
            const executable = getExecutableNodes(dag, []);

            expect(executable).toHaveLength(2);
            expect(executable.map(n => n.id).sort()).toEqual(['A', 'B']);
        });

        it('should exclude already solved nodes', () => {
            const dag = createTestDAG();
            const executable = getExecutableNodes(dag, ['A']);

            expect(executable).toHaveLength(1);
            expect(executable[0].id).toBe('B');
        });

        it('should return dependent node when dependencies are solved', () => {
            const dag = createTestDAG();
            const executable = getExecutableNodes(dag, ['A', 'B']);

            expect(executable).toHaveLength(1);
            expect(executable[0].id).toBe('C');
        });

        it('should not return dependent node when dependencies are not solved', () => {
            const dag = createTestDAG();
            const executable = getExecutableNodes(dag, ['A']); // B not solved

            expect(executable.map(n => n.id)).not.toContain('C');
        });

        it('should return empty array when all nodes are solved', () => {
            const dag = createTestDAG();
            const executable = getExecutableNodes(dag, ['A', 'B', 'C']);

            expect(executable).toHaveLength(0);
        });
    });

    describe('getNextNode', () => {
        it('should return highest priority node', () => {
            const dag = createTestDAG();
            const next = getNextNode(dag, []);

            expect(next).not.toBeNull();
            expect(next!.priority).toBe(1);
        });

        it('should prefer lower complexity when priorities are equal', () => {
            const dag = createTestDAG();
            const next = getNextNode(dag, []);

            // A and B both have priority 1, but A has complexity 2 vs B's 3
            expect(next!.id).toBe('A');
        });

        it('should return null when no nodes are executable', () => {
            const dag = createTestDAG();
            const next = getNextNode(dag, ['A', 'B', 'C']);

            expect(next).toBeNull();
        });

        it('should return dependent node after dependencies are solved', () => {
            const dag = createTestDAG();
            const next = getNextNode(dag, ['A', 'B']);

            expect(next!.id).toBe('C');
        });
    });

    describe('isDAGComplete', () => {
        it('should return false when no nodes are solved', () => {
            const dag = createTestDAG();
            expect(isDAGComplete(dag, [])).toBe(false);
        });

        it('should return false when some nodes are solved', () => {
            const dag = createTestDAG();
            expect(isDAGComplete(dag, ['A', 'B'])).toBe(false);
        });

        it('should return true when all nodes are solved', () => {
            const dag = createTestDAG();
            expect(isDAGComplete(dag, ['A', 'B', 'C'])).toBe(true);
        });

        it('should return true even if solved nodes are in different order', () => {
            const dag = createTestDAG();
            expect(isDAGComplete(dag, ['C', 'A', 'B'])).toBe(true);
        });
    });

    describe('markNodeSolved', () => {
        it('should add node to solvedNodes list', () => {
            const state: Partial<GraphState> = {
                errorDAG: createTestDAG(),
                solvedNodes: ['A']
            };

            const update = markNodeSolved(state as GraphState, 'B');

            expect(update.solvedNodes).toEqual(['A', 'B']);
        });

        it('should clear currentNodeId', () => {
            const state: Partial<GraphState> = {
                errorDAG: createTestDAG(),
                solvedNodes: [],
                currentNodeId: 'A'
            };

            const update = markNodeSolved(state as GraphState, 'A');

            expect(update.currentNodeId).toBeUndefined();
        });

        it('should return empty object if no DAG', () => {
            const state: Partial<GraphState> = {
                solvedNodes: []
            };

            const update = markNodeSolved(state as GraphState, 'A');

            expect(update).toEqual({});
        });
    });

    describe('getDAGProgress', () => {
        it('should return correct progress metrics', () => {
            const dag = createTestDAG();
            const progress = getDAGProgress(dag, ['A', 'B']);

            expect(progress.solved).toBe(2);
            expect(progress.total).toBe(3);
            expect(progress.percentage).toBe(67); // 2/3 = 66.67% rounded to 67
            expect(progress.remaining).toHaveLength(1);
            expect(progress.remaining[0].id).toBe('C');
        });

        it('should return 0% when nothing is solved', () => {
            const dag = createTestDAG();
            const progress = getDAGProgress(dag, []);

            expect(progress.percentage).toBe(0);
            expect(progress.remaining).toHaveLength(3);
        });

        it('should return 100% when everything is solved', () => {
            const dag = createTestDAG();
            const progress = getDAGProgress(dag, ['A', 'B', 'C']);

            expect(progress.percentage).toBe(100);
            expect(progress.remaining).toHaveLength(0);
        });
    });

    describe('describeDAGPlan', () => {
        it('should generate human-readable plan description', () => {
            const dag = createTestDAG();
            const description = describeDAGPlan(dag);

            expect(description).toContain('DAG Execution Plan');
            expect(description).toContain('3 nodes');
            expect(description).toContain('Multi-error scenario');
            expect(description).toContain('Priority 1');
            expect(description).toContain('Priority 2');
            expect(description).toContain('Fix A');
            expect(description).toContain('Fix B');
            expect(description).toContain('Fix C');
        });

        it('should show dependencies', () => {
            const dag = createTestDAG();
            const description = describeDAGPlan(dag);

            expect(description).toContain('(independent)'); // For A and B
            expect(description).toContain('(depends on: B)'); // For C
        });
    });
});
