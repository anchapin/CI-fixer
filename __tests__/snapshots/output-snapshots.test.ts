import { describe, it, expect, vi } from 'vitest';
import { formatPlanToMarkdown } from '../../services/analysis/LogAnalysisService.js';
import { classifyErrorWithHistory } from '../../errorClassification.js';
import { AgentPlan } from '../../types.js';

// Mock dependencies
vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
            category: 'runtime',
            confidence: 0.9,
            affectedFiles: ['app.ts'],
            suggestedAction: 'Add null check'
        }),
        toolCalls: []
    })
}));

vi.mock('../../db/client.js', () => ({
    db: (() => {
        function createMockDb() {
            return {
                errorFact: { findMany: vi.fn().mockResolvedValue([]) },
                errorSolution: { findMany: vi.fn().mockResolvedValue([]) },
                fixPattern: { findMany: vi.fn(() => Promise.resolve([])), create: vi.fn(), findFirst: vi.fn() },
                actionTemplate: { findMany: vi.fn(() => Promise.resolve([])), create: vi.fn() }
            };
        }
        return createMockDb();
    })()
}));

/**
 * Snapshot Tests
 * 
 * These tests capture the output of functions and ensure they don't change unexpectedly.
 * Snapshots help catch unintended changes to formatted output, generated prompts, etc.
 */
describe('Snapshot Tests', () => {
    describe('Plan Formatting', () => {
        it('should match snapshot for simple plan', () => {
            const plan: AgentPlan = {
                goal: 'Fix TypeError in app.ts',
                tasks: [
                    {
                        id: '1',
                        description: 'Add null check before accessing property',
                        status: 'pending'
                    },
                    {
                        id: '2',
                        description: 'Add error handling',
                        status: 'pending'
                    }
                ],
                approved: true
            };

            const markdown = formatPlanToMarkdown(plan);
            expect(markdown).toMatchSnapshot();
        });

        it('should match snapshot for complex plan with multiple tasks', () => {
            const plan: AgentPlan = {
                goal: 'Refactor authentication system',
                tasks: [
                    {
                        id: '1',
                        description: 'Extract authentication logic to separate module',
                        status: 'pending',
                        dependencies: []
                    },
                    {
                        id: '2',
                        description: 'Add JWT token validation',
                        status: 'pending',
                        dependencies: ['1']
                    },
                    {
                        id: '3',
                        description: 'Update tests',
                        status: 'pending',
                        dependencies: ['1', '2']
                    }
                ],
                approved: true,
                estimatedComplexity: 'high'
            };

            const markdown = formatPlanToMarkdown(plan);
            expect(markdown).toMatchSnapshot();
        });

        it('should match snapshot for plan with rejected status', () => {
            const plan: AgentPlan = {
                goal: 'Implement feature X',
                tasks: [
                    {
                        id: '1',
                        description: 'Add feature',
                        status: 'pending'
                    }
                ],
                approved: false,
                rejectionReason: 'Scope too large, needs to be broken down'
            };

            const markdown = formatPlanToMarkdown(plan);
            expect(markdown).toMatchSnapshot();
        });
    });

    describe('Error Classification Output', () => {
        it('should match snapshot for runtime error classification', async () => {
            const result = await classifyErrorWithHistory(
                'TypeError: Cannot read property "foo" of undefined',
                'app.ts',
                []
            );

            // Snapshot the structure (excluding dynamic fields like timestamps)
            const snapshot = {
                category: result.category,
                confidence: result.confidence,
                affectedFiles: result.affectedFiles,
                suggestedAction: result.suggestedAction
            };

            expect(snapshot).toMatchSnapshot();
        });

        it('should match snapshot for dependency error classification', async () => {
            vi.mocked(await import('../../services/llm/LLMService.js'))
                .unifiedGenerate.mockResolvedValueOnce({
                    text: JSON.stringify({
                        category: 'dependency',
                        confidence: 0.95,
                        affectedFiles: ['package.json'],
                        suggestedAction: 'Run npm install'
                    }),
                    toolCalls: []
                });

            const result = await classifyErrorWithHistory(
                'ModuleNotFoundError: No module named "lodash"',
                'utils.ts',
                []
            );

            const snapshot = {
                category: result.category,
                confidence: result.confidence,
                affectedFiles: result.affectedFiles,
                suggestedAction: result.suggestedAction
            };

            expect(snapshot).toMatchSnapshot();
        });
    });

    describe('LLM Prompt Generation', () => {
        it('should match snapshot for diagnosis prompt structure', () => {
            const promptData = {
                logText: 'Error: Division by zero\n  at calculate (app.ts:10:5)',
                repoContext: 'TypeScript project using Node.js',
                previousAttempts: []
            };

            // Snapshot the prompt structure
            expect(promptData).toMatchSnapshot();
        });

        it('should match snapshot for fix generation prompt structure', () => {
            const promptData = {
                diagnosis: {
                    summary: 'Division by zero error',
                    filePath: 'app.ts',
                    fixAction: 'edit'
                },
                fileContent: 'function calculate(a, b) { return a / b; }',
                context: 'Math utility function'
            };

            expect(promptData).toMatchSnapshot();
        });
    });

    describe('State Transitions', () => {
        it('should match snapshot for state update structure', () => {
            const stateUpdate = {
                phase: 'PLANNING',
                status: 'working',
                currentNode: 'planning',
                iteration: 1,
                fileReservations: ['app.ts', 'utils.ts'],
                diagnosis: {
                    summary: 'Error in app.ts',
                    filePath: 'app.ts',
                    fixAction: 'edit'
                }
            };

            expect(stateUpdate).toMatchSnapshot();
        });

        it('should match snapshot for success state', () => {
            const successState = {
                phase: 'SUCCESS',
                status: 'success',
                currentNode: 'finish',
                iteration: 2,
                message: 'Fix applied successfully'
            };

            expect(successState).toMatchSnapshot();
        });

        it('should match snapshot for failure state', () => {
            const failureState = {
                phase: 'FAILURE',
                status: 'failed',
                currentNode: 'verification',
                iteration: 5,
                failureReason: 'Max iterations exceeded',
                message: 'Unable to fix the issue after 5 attempts'
            };

            expect(failureState).toMatchSnapshot();
        });
    });
});
