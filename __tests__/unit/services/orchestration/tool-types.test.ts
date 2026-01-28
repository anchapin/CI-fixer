/**
 * Tests for tool-types.ts
 * Tool cost estimation and type definitions
 */

import { describe, it, expect } from 'vitest';
import {
    CIFixerTool,
    TOOL_COSTS,
    estimateTotalCost,
    estimateTotalLatency
} from '../../../../services/orchestration/tool-types';

describe('tool-types', () => {
    describe('CIFixerTool type', () => {
        it('should have all expected tool types', () => {
            const expectedTools: CIFixerTool[] = [
                'semantic_code_search',
                'syntax_validator',
                'dependency_resolver',
                'test_runner',
                'git_blame_analyzer',
                'llm_code_generator',
                'static_analyzer',
                'linter'
            ];

            expectedTools.forEach(tool => {
                expect(TOOL_COSTS[tool]).toBeDefined();
            });
        });
    });

    describe('TOOL_COSTS', () => {
        it('should have cost estimates for all tools', () => {
            const tools: CIFixerTool[] = [
                'semantic_code_search',
                'syntax_validator',
                'dependency_resolver',
                'test_runner',
                'git_blame_analyzer',
                'llm_code_generator',
                'static_analyzer',
                'linter'
            ];

            tools.forEach(tool => {
                const estimate = TOOL_COSTS[tool];
                expect(estimate).toBeDefined();
                expect(estimate.tool).toBe(tool);
                expect(estimate.estimatedCost).toBeGreaterThan(0);
                expect(estimate.estimatedLatency).toBeGreaterThan(0);
                expect(estimate.complexity).toBeGreaterThan(0);
                expect(estimate.complexity).toBeLessThanOrEqual(10);
            });
        });

        it('should have reasonable cost ranges', () => {
            const costs = Object.values(TOOL_COSTS).map(t => t.estimatedCost);
            const minCost = Math.min(...costs);
            const maxCost = Math.max(...costs);

            expect(minCost).toBeGreaterThan(0);
            expect(maxCost).toBeLessThan(1); // All tools should be less than $1
        });

        it('should have reasonable latency ranges', () => {
            const latencies = Object.values(TOOL_COSTS).map(t => t.estimatedLatency);
            const minLatency = Math.min(...latencies);
            const maxLatency = Math.max(...latencies);

            expect(minLatency).toBeGreaterThan(0);
            expect(maxLatency).toBeLessThan(30000); // No tool should take more than 30 seconds
        });
    });

    describe('estimateTotalCost', () => {
        it('should calculate total cost for empty array', () => {
            expect(estimateTotalCost([])).toBe(0);
        });

        it('should calculate total cost for single tool', () => {
            const tools: CIFixerTool[] = ['syntax_validator'];
            const expected = TOOL_COSTS.syntax_validator.estimatedCost;
            expect(estimateTotalCost(tools)).toBe(expected);
        });

        it('should calculate total cost for multiple tools', () => {
            const tools: CIFixerTool[] = ['syntax_validator', 'linter'];
            const expected = TOOL_COSTS.syntax_validator.estimatedCost +
                           TOOL_COSTS.linter.estimatedCost;
            expect(estimateTotalCost(tools)).toBeCloseTo(expected, 6);
        });

        it('should calculate total cost for expensive tools', () => {
            const tools: CIFixerTool[] = ['llm_code_generator', 'semantic_code_search'];
            const expected = TOOL_COSTS.llm_code_generator.estimatedCost +
                           TOOL_COSTS.semantic_code_search.estimatedCost;
            expect(estimateTotalCost(tools)).toBeCloseTo(expected, 6);
        });

        it('should handle duplicate tools', () => {
            const tools: CIFixerTool[] = ['syntax_validator', 'syntax_validator'];
            const expected = TOOL_COSTS.syntax_validator.estimatedCost * 2;
            expect(estimateTotalCost(tools)).toBeCloseTo(expected, 6);
        });
    });

    describe('estimateTotalLatency', () => {
        it('should calculate total latency for empty array', () => {
            expect(estimateTotalLatency([])).toBe(0);
        });

        it('should calculate total latency for single tool', () => {
            const tools: CIFixerTool[] = ['syntax_validator'];
            const expected = TOOL_COSTS.syntax_validator.estimatedLatency;
            expect(estimateTotalLatency(tools)).toBe(expected);
        });

        it('should calculate total latency for multiple tools', () => {
            const tools: CIFixerTool[] = ['syntax_validator', 'linter'];
            const expected = TOOL_COSTS.syntax_validator.estimatedLatency +
                           TOOL_COSTS.linter.estimatedLatency;
            expect(estimateTotalLatency(tools)).toBe(expected);
        });

        it('should calculate total latency for slow tools', () => {
            const tools: CIFixerTool[] = ['test_runner', 'llm_code_generator'];
            const expected = TOOL_COSTS.test_runner.estimatedLatency +
                           TOOL_COSTS.llm_code_generator.estimatedLatency;
            expect(estimateTotalLatency(tools)).toBe(expected);
        });

        it('should handle duplicate tools', () => {
            const tools: CIFixerTool[] = ['test_runner', 'test_runner'];
            const expected = TOOL_COSTS.test_runner.estimatedLatency * 2;
            expect(estimateTotalLatency(tools)).toBe(expected);
        });
    });

    describe('Tool cost ordering', () => {
        it('should order tools by cost (cheapest first)', () => {
            const tools = Object.values(TOOL_COSTS).sort((a, b) =>
                a.estimatedCost - b.estimatedCost
            );

            // First tool should be the cheapest (syntax_validator or linter, both 0.001)
            expect(['syntax_validator', 'linter']).toContain(tools[0].tool);
            // First tool should be less than or equal to the second (allowing equal costs)
            expect(tools[0].estimatedCost).toBeLessThanOrEqual(tools[1].estimatedCost);
        });

        it('should order tools by latency (fastest first)', () => {
            const tools = Object.values(TOOL_COSTS).sort((a, b) =>
                a.estimatedLatency - b.estimatedLatency
            );

            // Fastest tools should be linter or syntax_validator (both 100ms)
            expect(['linter', 'syntax_validator']).toContain(tools[0].tool);
        });

        it('should order tools by complexity (simplest first)', () => {
            const tools = Object.values(TOOL_COSTS).sort((a, b) =>
                a.complexity - b.complexity
            );

            expect(tools[0].complexity).toBe(1);
            expect(tools[tools.length - 1].complexity).toBe(10);
        });
    });
});
