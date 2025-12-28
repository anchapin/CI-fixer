import { describe, it, expect, vi } from 'vitest';
import { ErrorNode, ErrorDAG } from '../../types.js';

// Import the validation functions by extracting them from the decomposition node
// Since they're not exported, we'll test them indirectly through the node
// For now, we'll create standalone test versions

/**
 * Test version of validateDAG function
 */
function validateDAG(dag: { nodes: ErrorNode[]; edges: Array<{ from: string; to: string }> }): { valid: boolean; error?: string } {
    // Check for nodes
    if (dag.nodes.length === 0) {
        return { valid: false, error: 'No nodes in DAG' };
    }

    // Check for duplicate node IDs
    const nodeIds = new Set<string>();
    for (const node of dag.nodes) {
        if (nodeIds.has(node.id)) {
            return { valid: false, error: `Duplicate node ID: ${node.id}` };
        }
        nodeIds.add(node.id);
    }

    // Check that all edge references exist
    for (const edge of dag.edges) {
        if (!nodeIds.has(edge.from)) {
            return { valid: false, error: `Edge references non-existent node: ${edge.from}` };
        }
        if (!nodeIds.has(edge.to)) {
            return { valid: false, error: `Edge references non-existent node: ${edge.to}` };
        }
    }

    // Check for cycles using DFS
    const hasCycle = detectCycle(dag.nodes, dag.edges);
    if (hasCycle) {
        return { valid: false, error: 'DAG contains cycles' };
    }

    return { valid: true };
}

/**
 * Test version of detectCycle function
 */
function detectCycle(nodes: ErrorNode[], edges: Array<{ from: string; to: string }>): boolean {
    const adjacency = new Map<string, string[]>();

    // Build adjacency list
    for (const node of nodes) {
        adjacency.set(node.id, []);
    }
    for (const edge of edges) {
        adjacency.get(edge.from)?.push(edge.to);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function dfs(nodeId: string): boolean {
        visited.add(nodeId);
        recStack.add(nodeId);

        const neighbors = adjacency.get(nodeId) || [];
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                if (dfs(neighbor)) {
                    return true;
                }
            } else if (recStack.has(neighbor)) {
                return true; // Cycle detected
            }
        }

        recStack.delete(nodeId);
        return false;
    }

    for (const node of nodes) {
        if (!visited.has(node.id)) {
            if (dfs(node.id)) {
                return true;
            }
        }
    }

    return false;
}

describe('DAG Validation', () => {
    describe('validateDAG', () => {
        it('should accept valid DAG with no cycles', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                    { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 2, complexity: 2 }
                ],
                edges: [{ from: 'A', to: 'B' }]
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should reject DAG with no nodes', () => {
            const dag = {
                nodes: [],
                edges: []
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('No nodes in DAG');
        });

        it('should reject DAG with duplicate node IDs', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                    { id: 'A', problem: 'Fix A again', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 }
                ],
                edges: []
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Duplicate node ID');
        });

        it('should reject DAG with edge to non-existent node', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 }
                ],
                edges: [{ from: 'A', to: 'B' }] // B doesn't exist
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('non-existent node');
        });

        it('should reject DAG with edge from non-existent node', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 }
                ],
                edges: [{ from: 'B', to: 'A' }] // B doesn't exist
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('non-existent node');
        });

        it('should reject DAG with simple cycle', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: ['B'], priority: 1, complexity: 2 },
                    { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 1, complexity: 2 }
                ],
                edges: [
                    { from: 'A', to: 'B' },
                    { from: 'B', to: 'A' }
                ]
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('DAG contains cycles');
        });

        it('should reject DAG with complex cycle', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                    { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 2, complexity: 2 },
                    { id: 'C', problem: 'Fix C', category: 'SYNTAX', affectedFiles: [], dependencies: ['B'], priority: 3, complexity: 2 }
                ],
                edges: [
                    { from: 'A', to: 'B' },
                    { from: 'B', to: 'C' },
                    { from: 'C', to: 'A' } // Creates cycle
                ]
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('DAG contains cycles');
        });

        it('should accept DAG with multiple independent nodes', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                    { id: 'B', problem: 'Fix B', category: 'DEPENDENCY', affectedFiles: [], dependencies: [], priority: 1, complexity: 3 },
                    { id: 'C', problem: 'Fix C', category: 'CONFIG', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 }
                ],
                edges: [] // No dependencies
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(true);
        });

        it('should accept DAG with diamond pattern', () => {
            const dag = {
                nodes: [
                    { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                    { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 2, complexity: 2 },
                    { id: 'C', problem: 'Fix C', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 2, complexity: 2 },
                    { id: 'D', problem: 'Fix D', category: 'SYNTAX', affectedFiles: [], dependencies: ['B', 'C'], priority: 3, complexity: 2 }
                ],
                edges: [
                    { from: 'A', to: 'B' },
                    { from: 'A', to: 'C' },
                    { from: 'B', to: 'D' },
                    { from: 'C', to: 'D' }
                ]
            };

            const result = validateDAG(dag);
            expect(result.valid).toBe(true);
        });
    });

    describe('detectCycle', () => {
        it('should return false for acyclic graph', () => {
            const nodes: ErrorNode[] = [
                { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 2, complexity: 2 }
            ];
            const edges = [{ from: 'A', to: 'B' }];

            expect(detectCycle(nodes, edges)).toBe(false);
        });

        it('should return true for simple cycle', () => {
            const nodes: ErrorNode[] = [
                { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: ['B'], priority: 1, complexity: 2 },
                { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 1, complexity: 2 }
            ];
            const edges = [
                { from: 'A', to: 'B' },
                { from: 'B', to: 'A' }
            ];

            expect(detectCycle(nodes, edges)).toBe(true);
        });

        it('should return true for self-loop', () => {
            const nodes: ErrorNode[] = [
                { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 1, complexity: 2 }
            ];
            const edges = [{ from: 'A', to: 'A' }];

            expect(detectCycle(nodes, edges)).toBe(true);
        });

        it('should return false for disconnected acyclic components', () => {
            const nodes: ErrorNode[] = [
                { id: 'A', problem: 'Fix A', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                { id: 'B', problem: 'Fix B', category: 'SYNTAX', affectedFiles: [], dependencies: [], priority: 1, complexity: 2 },
                { id: 'C', problem: 'Fix C', category: 'SYNTAX', affectedFiles: [], dependencies: ['A'], priority: 2, complexity: 2 }
            ];
            const edges = [{ from: 'A', to: 'C' }]; // B is disconnected

            expect(detectCycle(nodes, edges)).toBe(false);
        });
    });
});
