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
    | 'linter'                  // Cheap, always useful
    | 'read_file'               // Basic IO
    | 'write_file'              // Basic IO
    | 'run_cmd'                 // Basic IO
    | 'file_search'             // Basic IO
    | 'read_file_with_limit'    // Basic IO
    | 'run_test'                // Alias/Variant
    | 'git_diff'                // Git
    | 'semantic_search';        // Alias

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
    'semantic_search': {
        tool: 'semantic_search',
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
    'run_test': {
        tool: 'run_test',
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
    },
    'read_file': {
        tool: 'read_file',
        estimatedCost: 0.0001,
        estimatedLatency: 10,
        complexity: 1
    },
    'write_file': {
        tool: 'write_file',
        estimatedCost: 0.0001,
        estimatedLatency: 20,
        complexity: 1
    },
    'run_cmd': {
        tool: 'run_cmd',
        estimatedCost: 0.0005,
        estimatedLatency: 100,
        complexity: 1
    },
    'file_search': {
        tool: 'file_search',
        estimatedCost: 0.0002,
        estimatedLatency: 50,
        complexity: 1
    },
    'read_file_with_limit': {
        tool: 'read_file_with_limit',
        estimatedCost: 0.0001,
        estimatedLatency: 10,
        complexity: 1
    },
    'git_diff': {
        tool: 'git_diff',
        estimatedCost: 0.0005,
        estimatedLatency: 50,
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

/**
 * Get a list of tools that fit within a specified budget.
 *
 * @param maxCost Maximum allowable cost
 * @returns List of tool names
 */
export function getCostEfficientTools(maxCost: number): CIFixerTool[] {
    // Sort tools by cost (ascending) to maximize tool count within budget
    // Note: This is a naive knapsack implementation, but sufficient for this use case
    const allTools = Object.values(TOOL_COSTS).sort((a, b) => a.estimatedCost - b.estimatedCost);

    const selectedTools: CIFixerTool[] = [];
    let currentCost = 0;

    for (const tool of allTools) {
        if (currentCost + tool.estimatedCost <= maxCost) {
            selectedTools.push(tool.tool);
            currentCost += tool.estimatedCost;
        }
    }

    return selectedTools;
}
