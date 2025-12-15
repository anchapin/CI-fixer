import { describe, it, expect } from 'vitest';
import { ToolOrchestrator } from '../../services/orchestration/tool-selector.js';
import { TOOL_COSTS } from '../../services/orchestration/tool-types.js';

describe('ToolOrchestrator', () => {
    const orchestrator = new ToolOrchestrator();

    describe('selectOptimalTools', () => {
        it('should select syntax validator for simple syntax errors', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Syntax error', filePath: 'test.ts', fixAction: 'edit', confidence: 0.8 },
                {
                    errorCategory: 'SYNTAX_ERROR',
                    complexity: 2,
                    affectedFiles: [],
                    budget: 1.0,
                    previousAttempts: 0
                }
            );

            expect(tools).toContain('syntax_validator');
            expect(tools).not.toContain('semantic_code_search'); // Too expensive for simple error
        });

        it('should select dependency resolver for import errors', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Import error', filePath: 'test.ts', fixAction: 'command', confidence: 0.8 },
                {
                    errorCategory: 'IMPORT_ERROR',
                    complexity: 4,
                    affectedFiles: [],
                    budget: 1.0,
                    previousAttempts: 0
                }
            );

            expect(tools).toContain('dependency_resolver');
        });

        it('should select test runner for test failures', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Test failed', filePath: 'test.spec.ts', fixAction: 'edit', confidence: 0.8 },
                {
                    errorCategory: 'TEST_FAILURE',
                    complexity: 5,
                    affectedFiles: [],
                    budget: 1.0,
                    previousAttempts: 0
                }
            );

            expect(tools).toContain('test_runner');
            expect(tools).toContain('git_blame_analyzer');
        });

        it('should avoid expensive tools when budget is low', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Complex error', filePath: 'test.ts', fixAction: 'edit', confidence: 0.8 },
                {
                    errorCategory: 'UNKNOWN',
                    complexity: 9,
                    affectedFiles: [],
                    budget: 0.01, // Very low budget
                    previousAttempts: 0
                }
            );

            expect(tools).not.toContain('semantic_code_search');
            expect(tools).not.toContain('test_runner');
        });

        it('should include semantic search for complex errors with budget', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Complex error', filePath: 'test.ts', fixAction: 'edit', confidence: 0.8 },
                {
                    errorCategory: 'UNKNOWN',
                    complexity: 8,
                    affectedFiles: [],
                    budget: 1.0,
                    previousAttempts: 0
                }
            );

            expect(tools).toContain('semantic_code_search');
        });

        it('should always include at least one tool (fallback to LLM)', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Unknown error', filePath: 'test.ts', fixAction: 'edit', confidence: 0.5 },
                {
                    errorCategory: 'UNKNOWN',
                    complexity: 5,
                    affectedFiles: [],
                    budget: 0.001, // Extremely low budget
                    previousAttempts: 0
                }
            );

            expect(tools.length).toBeGreaterThan(0);
            expect(tools).toContain('llm_code_generator'); // Fallback
        });

        it('should respect user preferences to avoid tools', () => {
            const tools = orchestrator.selectOptimalTools(
                { summary: 'Test error', filePath: 'test.ts', fixAction: 'edit', confidence: 0.8 },
                {
                    errorCategory: 'SYNTAX_ERROR', // Changed from TEST_FAILURE
                    complexity: 5,
                    affectedFiles: [],
                    budget: 1.0,
                    previousAttempts: 0,
                    preferences: { avoidTools: ['semantic_code_search'] }
                }
            );

            expect(tools).not.toContain('semantic_code_search');
        });
    });
});

describe('getExecutionOrder', () => {
    let orchestrator: ToolOrchestrator;

    beforeEach(() => {
        orchestrator = new ToolOrchestrator(1000);
    });

    it('should order tools by priority', () => {
        const tools = ['llm_code_generator', 'syntax_validator', 'semantic_code_search'];
        const ordered = orchestrator.getExecutionOrder(tools);

        expect(ordered[0]).toBe('syntax_validator'); // Should run first
        expect(ordered[ordered.length - 1]).toBe('llm_code_generator'); // Should run last
    });
});
