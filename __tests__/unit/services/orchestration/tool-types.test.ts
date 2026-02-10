import { describe, it, expect } from 'vitest';
import { TOOL_COSTS, getCostEfficientTools } from '../../../services/orchestration/tool-types.js';

describe('tool-types', () => {
    describe('TOOL_COSTS', () => {
        it('should have cost defined for all tools', () => {
            const toolNames = [
                'read_file',
                'write_file',
                'run_cmd',
                'file_search',
                'semantic_search',
                'read_file_with_limit',
                'run_test',
                'git_diff',
                'linter',
                'syntax_validator'
            ];

            toolNames.forEach(tool => {
                expect(TOOL_COSTS).toHaveProperty(tool);
                expect(TOOL_COSTS[tool].estimatedCost).toBeGreaterThan(0);
            });
        });

        it('should have higher cost for expensive tools', () => {
            expect(TOOL_COSTS['semantic_search'].estimatedCost).toBeGreaterThan(TOOL_COSTS['read_file'].estimatedCost);
            expect(TOOL_COSTS['run_test'].estimatedCost).toBeGreaterThan(TOOL_COSTS['linter'].estimatedCost);
        });
    });

    describe('getCostEfficientTools', () => {
        it('should return tools within budget', () => {
            const tools = getCostEfficientTools(0.05);

            // Should include cheap tools
            expect(tools).toContain('read_file');
            expect(tools).toContain('linter');

            // Should exclude expensive tools
            expect(tools).not.toContain('run_test'); // 0.10
        });

        it('should return empty list for very low budget', () => {
            const tools = getCostEfficientTools(0.0001);
            expect(tools).toHaveLength(0);
        });

        it('should return all tools for high budget', () => {
            const tools = getCostEfficientTools(100);
            expect(tools.length).toBeGreaterThan(5);
        });
    });

    describe('Tool cost ordering', () => {
        it('should order tools by cost (cheapest first)', () => {
            const tools = getCostEfficientTools(1.0);

            // Check ordering
            for (let i = 0; i < tools.length - 1; i++) {
                const costA = TOOL_COSTS[tools[i]].estimatedCost;
                const costB = TOOL_COSTS[tools[i+1]].estimatedCost;

                expect(costA).toBeLessThanOrEqual(costB);
            }
        });

        it('should verify specific tool order expectations', () => {
            const tools = getCostEfficientTools(1.0);

            // First tool should be the cheapest (syntax_validator or linter or read_file)
            expect(['syntax_validator', 'linter', 'read_file']).toContain(tools[0]);

            // Using toBeLessThanOrEqual to account for floating point precision and equal costs
            expect(TOOL_COSTS[tools[0]].estimatedCost).toBeLessThanOrEqual(TOOL_COSTS[tools[1]].estimatedCost);
        });
    });
});
