import { ErrorDAG, ErrorNode } from '../types.js';
import { GraphState } from '../agent/graph/state.js';

/**
 * DAG Executor - AoT Phase 3
 * 
 * Utilities for executing DAG nodes in dependency order.
 */

/**
 * Gets all nodes that are ready to execute (all dependencies solved)
 */
export function getExecutableNodes(dag: ErrorDAG, solvedNodes: string[]): ErrorNode[] {
    return dag.nodes.filter(node => {
        // Already solved?
        if (solvedNodes.includes(node.id)) {
            return false;
        }

        // All dependencies solved?
        return node.dependencies.every(dep => solvedNodes.includes(dep));
    });
}

/**
 * Gets the next node to execute (highest priority among executable nodes)
 */
export function getNextNode(dag: ErrorDAG, solvedNodes: string[]): ErrorNode | null {
    const executable = getExecutableNodes(dag, solvedNodes);

    if (executable.length === 0) {
        return null;
    }

    // Sort by priority (1 = highest) then by complexity (lower first)
    executable.sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        return a.complexity - b.complexity;
    });

    return executable[0];
}

/**
 * Checks if all nodes in the DAG have been solved
 */
export function isDAGComplete(dag: ErrorDAG, solvedNodes: string[]): boolean {
    return dag.nodes.every(node => solvedNodes.includes(node.id));
}

/**
 * Marks a node as solved and returns updated state
 */
export function markNodeSolved(state: GraphState, nodeId: string): Partial<GraphState> {
    if (!state.errorDAG) {
        return {};
    }

    const updatedSolvedNodes = [...state.solvedNodes, nodeId];

    return {
        solvedNodes: updatedSolvedNodes,
        currentNodeId: undefined
    };
}

/**
 * Gets progress information for logging
 */
export function getDAGProgress(dag: ErrorDAG, solvedNodes: string[]): {
    solved: number;
    total: number;
    percentage: number;
    remaining: ErrorNode[];
} {
    const remaining = dag.nodes.filter(node => !solvedNodes.includes(node.id));

    return {
        solved: solvedNodes.length,
        total: dag.nodes.length,
        percentage: Math.round((solvedNodes.length / dag.nodes.length) * 100),
        remaining
    };
}

/**
 * Gets a human-readable description of the DAG execution plan
 */
export function describeDAGPlan(dag: ErrorDAG): string {
    const lines: string[] = [];

    lines.push(`DAG Execution Plan (${dag.nodes.length} nodes):`);
    lines.push(`Root Problem: ${dag.rootProblem}`);
    lines.push('');

    // Group by priority
    const byPriority = new Map<number, ErrorNode[]>();
    for (const node of dag.nodes) {
        if (!byPriority.has(node.priority)) {
            byPriority.set(node.priority, []);
        }
        byPriority.get(node.priority)!.push(node);
    }

    // Sort priorities
    const priorities = Array.from(byPriority.keys()).sort((a, b) => a - b);

    for (const priority of priorities) {
        const nodes = byPriority.get(priority)!;
        lines.push(`Priority ${priority}:`);
        for (const node of nodes) {
            const deps = node.dependencies.length > 0
                ? ` (depends on: ${node.dependencies.join(', ')})`
                : ' (independent)';
            lines.push(`  - ${node.id}: ${node.problem}${deps}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}
