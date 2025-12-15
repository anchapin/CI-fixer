/**
 * Tool Orchestrator - Dynamic Tool Selection
 * 
 * Implements ToolOrchestra strategy for selecting optimal tools based on:
 * - Error category and complexity
 * - Budget constraints
 * - Historical success patterns
 * - User preferences
 */

import { CIFixerTool, TOOL_COSTS } from './tool-types.js';
import { DiagnosisResult } from '../analysis/LogAnalysisService.js';

export interface ToolSelectionContext {
    errorCategory: string;
    complexity: number;
    affectedFiles: string[];
    budget: number;
    previousAttempts: number;
    preferences?: any;
}

export class ToolOrchestrator {
    /**
     * Select optimal tools for the given error diagnosis and context
     */
    selectOptimalTools(diagnosis: DiagnosisResult, context: ToolSelectionContext): CIFixerTool[] {
        const tools: CIFixerTool[] = [];
        let remainingBudget = context.budget;

        // Always run cheap validators first (unless budget is extremely constrained)
        if (remainingBudget > 0.005 && this.shouldUseTool('syntax_validator', context)) {
            tools.push('syntax_validator');
            remainingBudget -= TOOL_COSTS['syntax_validator'].estimatedCost;
        }

        // Category-specific tool selection
        if (diagnosis.fixAction === 'command' || context.errorCategory === 'DEPENDENCY_ERROR' || context.errorCategory === 'IMPORT_ERROR') {
            if (remainingBudget > TOOL_COSTS['dependency_resolver'].estimatedCost) {
                tools.push('dependency_resolver');
                remainingBudget -= TOOL_COSTS['dependency_resolver'].estimatedCost;
            }
        }

        if (context.errorCategory === 'TEST_FAILURE') {
            if (remainingBudget > TOOL_COSTS['test_runner'].estimatedCost) {
                tools.push('test_runner');
                remainingBudget -= TOOL_COSTS['test_runner'].estimatedCost;
            }

            if (remainingBudget > TOOL_COSTS['git_blame_analyzer'].estimatedCost) {
                tools.push('git_blame_analyzer');
                remainingBudget -= TOOL_COSTS['git_blame_analyzer'].estimatedCost;
            }
        }

        if (context.errorCategory === 'SYNTAX_ERROR' || context.errorCategory === 'TYPE_ERROR') {
            if (remainingBudget > TOOL_COSTS['static_analyzer'].estimatedCost) {
                tools.push('static_analyzer');
                remainingBudget -= TOOL_COSTS['static_analyzer'].estimatedCost;
            }
        }

        // For complex errors with sufficient budget, use semantic search
        if (context.complexity > 7 && remainingBudget > TOOL_COSTS['semantic_code_search'].estimatedCost) {
            tools.push('semantic_code_search');
            remainingBudget -= TOOL_COSTS['semantic_code_search'].estimatedCost;
        }

        // LLM code gen as last resort or for high complexity
        // Only use if we have budget and either:
        // 1. No other tools were selected, OR
        // 2. Complexity is very high (>8)
        const needsLLM = tools.length === 0 || context.complexity > 8;
        if (needsLLM && remainingBudget > TOOL_COSTS['llm_code_generator'].estimatedCost) {
            tools.push('llm_code_generator');
        } else if (tools.length === 0) {
            // Fallback: always include LLM even if over budget (but log warning)
            tools.push('llm_code_generator');
            console.warn('[ToolOrchestrator] Budget exceeded, but including LLM as fallback');
        }

        return tools;
    }

    /**
     * Determine if a tool should be used based on context
     */
    private shouldUseTool(tool: CIFixerTool, context: ToolSelectionContext): boolean {
        // Skip expensive tools for simple errors
        if (context.complexity < 4 && TOOL_COSTS[tool].complexity > 5) {
            return false;
        }

        // Skip tools that would exceed budget
        if (context.budget < TOOL_COSTS[tool].estimatedCost) {
            return false;
        }

        // Check user preferences if available
        if (context.preferences?.avoidTools?.includes(tool)) {
            return false;
        }

        return true;
    }

    /**
     * Get execution order for tools (some tools should run before others)
     */
    getExecutionOrder(tools: CIFixerTool[]): CIFixerTool[] {
        const priority: Record<CIFixerTool, number> = {
            'syntax_validator': 1,      // Run first
            'linter': 2,
            'static_analyzer': 3,
            'dependency_resolver': 4,
            'git_blame_analyzer': 5,
            'semantic_code_search': 6,
            'test_runner': 7,
            'llm_code_generator': 8     // Run last
        };

        return [...tools].sort((a, b) => priority[a] - priority[b]);
    }
}
