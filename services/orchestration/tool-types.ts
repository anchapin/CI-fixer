/**
 * Tool Types and Cost Estimates for CI-Fixer
 * 
 * Defines the available tools and their associated costs/latencies
 * for intelligent tool orchestration (ToolOrchestra strategy)
 */

export type CIFixerTool =
    | 'semantic_code_search'    // Expensive, high-value for complex errors
    | 'syntax_validator'        // Cheap, essential for syntax errors
    | 'dependency_resolver'     // Medium cost, critical for import errors
    | 'test_runner'             // Expensive, needed for test failures
    | 'git_blame_analyzer'      // Cheap, useful for regressions
    | 'llm_code_generator'      // Very expensive, last resort
    | 'static_analyzer'         // Cheap, good for type errors
    | 'linter';                 // Cheap, always useful

export interface ToolCostEstimate {
    tool: CIFixerTool;
    estimatedCost: number;      // USD
    estimatedLatency: number;   // milliseconds
    complexity: number;         // 1-10 (how complex the tool operation is)
}

/**
 * Cost estimates for each tool
 * These are approximate values based on typical usage patterns
 */
export const TOOL_COSTS: Record<CIFixerTool, ToolCostEstimate> = {
    'semantic_code_search': {
        tool: 'semantic_code_search',
        estimatedCost: 0.05,
        estimatedLatency: 3000,
        complexity: 8
    },
    'syntax_validator': {
        tool: 'syntax_validator',
        estimatedCost: 0.001,
        estimatedLatency: 100,
        complexity: 1
    },
    'dependency_resolver': {
        tool: 'dependency_resolver',
        estimatedCost: 0.01,
        estimatedLatency: 500,
        complexity: 3
    },
    'test_runner': {
        tool: 'test_runner',
        estimatedCost: 0.02,
        estimatedLatency: 5000,
        complexity: 5
    },
    'git_blame_analyzer': {
        tool: 'git_blame_analyzer',
        estimatedCost: 0.005,
        estimatedLatency: 200,
        complexity: 2
    },
    'llm_code_generator': {
        tool: 'llm_code_generator',
        estimatedCost: 0.10,
        estimatedLatency: 8000,
        complexity: 10
    },
    'static_analyzer': {
        tool: 'static_analyzer',
        estimatedCost: 0.002,
        estimatedLatency: 150,
        complexity: 2
    },
    'linter': {
        tool: 'linter',
        estimatedCost: 0.001,
        estimatedLatency: 100,
        complexity: 1
    }
};

/**
 * Get total estimated cost for a set of tools
 */
export function estimateTotalCost(tools: CIFixerTool[]): number {
    return tools.reduce((sum, tool) => sum + TOOL_COSTS[tool].estimatedCost, 0);
}

/**
 * Get total estimated latency for a set of tools (assuming sequential execution)
 */
export function estimateTotalLatency(tools: CIFixerTool[]): number {
    return tools.reduce((sum, tool) => sum + TOOL_COSTS[tool].estimatedLatency, 0);
}
