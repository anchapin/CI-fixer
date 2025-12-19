import { GraphState, GraphContext, NodeHandler } from '../state.js';
import { ErrorDAG, ErrorNode } from '../../../types.js';
import { estimateComplexity } from '../../../services/complexity-estimator.js';

/**
 * Decomposition Node - AoT Phase 2
 * 
 * Analyzes complex errors and decomposes them into a DAG of sub-problems.
 * Only activates for high-complexity errors (> 8).
 */
export const decompositionNode: NodeHandler = async (state, context) => {
    const { config, diagnosis, classification, problemComplexity } = state;
    const { logCallback, services } = context;

    const log = (level: string, msg: string) => logCallback(level as any, msg);

    log('INFO', '[DecompositionNode] Analyzing error for decomposition...');

    // Check if decomposition is warranted
    if (!problemComplexity || problemComplexity <= 8) {
        log('INFO', `[DecompositionNode] Complexity ${problemComplexity} <= 8. Skipping decomposition.`);
        return {
            currentNode: 'planning' // Skip to planning
        };
    }

    if (!diagnosis) {
        log('WARN', '[DecompositionNode] No diagnosis available. Skipping decomposition.');
        return {
            currentNode: 'planning'
        };
    }

    // Generate DAG using LLM
    try {
        const dag = await generateErrorDAG(
            config,
            diagnosis.summary,
            classification?.category || 'UNKNOWN',
            problemComplexity,
            classification?.affectedFiles || [],
            state.feedback,
            services
        );

        if (!dag.shouldDecompose) {
            log('INFO', `[DecompositionNode] LLM decided not to decompose: ${dag.reasoning}`);
            return {
                currentNode: 'planning'
            };
        }

        // Validate DAG
        const validation = validateDAG(dag);
        if (!validation.valid) {
            log('ERROR', `[DecompositionNode] Invalid DAG: ${validation.error}`);
            return {
                currentNode: 'planning' // Fall back to normal flow
            };
        }

        log('INFO', `[DecompositionNode] Created DAG with ${dag.nodes.length} nodes`);
        log('VERBOSE', `[DecompositionNode] Nodes: ${dag.nodes.map(n => n.id).join(', ')}`);
        log('VERBOSE', `[DecompositionNode] Edges: ${dag.edges.map(e => `${e.from}->${e.to}`).join(', ')}`);

        // Store DAG in state
        return {
            errorDAG: {
                nodes: dag.nodes,
                edges: dag.edges,
                rootProblem: diagnosis.summary
            },
            currentNode: 'planning' // Planning will handle DAG-based planning
        };

    } catch (e: any) {
        log('ERROR', `[DecompositionNode] Failed to generate DAG: ${e.message}`);
        return {
            currentNode: 'planning' // Fall back to normal flow
        };
    }
};

/**
 * Generates an ErrorDAG from diagnosis using LLM
 */
async function generateErrorDAG(
    config: any,
    diagnosis: string,
    category: string,
    complexity: number,
    affectedFiles: string[],
    feedbackHistory: string[] | undefined,
    services: ServiceContainer
): Promise<{ shouldDecompose: boolean; reasoning: string; nodes: ErrorNode[]; edges: Array<{ from: string; to: string }> }> {
    const { loadPrompt, renderPrompt, getPromptConfig } = await import('../../../services/llm/prompt-loader.js');

    const template = await loadPrompt('decomposition/error-decomposition', 'v1');

    const prompt = renderPrompt(template, {
        diagnosis,
        category,
        complexity,
        affectedFiles: affectedFiles.join(', ') || 'Unknown',
        feedbackHistory: feedbackHistory?.map((f, i) => `${i + 1}. ${f}`).join('\n') || ''
    });

    const response = await services.llm.unifiedGenerate(config, {
        contents: prompt,
        config: getPromptConfig(template),
        model: template.metadata.model
    });

    const result = services.llm.safeJsonParse(response.text || '{}', {
        shouldDecompose: false,
        reasoning: 'Failed to parse response',
        nodes: [],
        edges: []
    });

    return result;
}

/**
 * Validates a DAG structure
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
 * Detects cycles in a directed graph using DFS
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
