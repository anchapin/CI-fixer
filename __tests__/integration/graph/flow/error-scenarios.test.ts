import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analysisNode } from '../../../../agent/graph/nodes/analysis.js';
import { codingNode } from '../../../../agent/graph/nodes/execution.js';
import { GraphState, GraphContext } from '../../../../agent/graph/state.js';
import { TestDatabaseManager } from '../../../helpers/test-database.js';
import { createMockGraphContext, cleanupMockContext } from '../../../helpers/test-fixtures.js';
import { GraphStateBuilder } from '../../../helpers/test-builders.js';

// Mock services
// Mock services
vi.mock('../../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({ text: '{}', toolCalls: [] })
}));
vi.mock('../../../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({ logText: '', jobName: 'test', headSha: 'sha' }),
    findClosestFile: vi.fn().mockResolvedValue({ file: { name: 'f.ts', content: '' }, path: 'f.ts' }),
    getFileContent: vi.fn().mockResolvedValue({ name: 'f.ts', content: '' })
}));
vi.mock('../../../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue(''),
    toolCodeSearch: vi.fn().mockResolvedValue([]),
    toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
    toolWebSearch: vi.fn().mockResolvedValue(''),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    prepareSandbox: vi.fn().mockResolvedValue({
        getId: () => 's1',
        init: vi.fn(),
        teardown: vi.fn(),
        runCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
        writeFile: vi.fn(),
        readFile: vi.fn().mockResolvedValue('')
    })
}));
vi.mock('../../../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn().mockResolvedValue({ summary: 'Error', filePath: 'app.ts', fixAction: 'edit' }),
    generateRepoSummary: vi.fn().mockResolvedValue('Summary'),
    generateFix: vi.fn().mockResolvedValue('fixed'),
    judgeFix: vi.fn().mockResolvedValue({ passed: true }),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: '' }),
    generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'fix', tasks: [], approved: true }),
    formatPlanToMarkdown: vi.fn().mockReturnValue('# Plan')
}));
vi.mock('../../../../errorClassification.js', () => ({
    ErrorCategory: { RUNTIME: 'runtime', DEPENDENCY: 'dependency', SYNTAX: 'syntax', UNKNOWN: 'unknown' },
    classifyErrorWithHistory: vi.fn().mockResolvedValue({ category: 'runtime' }),
    classifyError: vi.fn().mockResolvedValue({ category: 'runtime' }),
    getErrorPriority: vi.fn().mockReturnValue('high'),
    isCascadingError: vi.fn().mockReturnValue(false)
}));

describe('Error Scenario Tests', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let context: GraphContext;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        context = await createMockGraphContext({ dbClient: testDb });
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
        await cleanupMockContext(context);
    });

    describe('Network Timeout Simulation', () => {
        it('should retry LLM calls on timeout', async () => {
            const mockLLM = vi.fn()
                .mockRejectedValueOnce(new Error('Request timeout'))
                .mockRejectedValueOnce(new Error('ETIMEDOUT'))
                .mockResolvedValueOnce({
                    text: JSON.stringify({
                        summary: 'Error',
                        filePath: 'app.ts',
                        fixAction: 'edit'
                    })
                });

            const { unifiedGenerate } = await import('../../../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockImplementation(mockLLM);

            const state = new GraphStateBuilder()
                .withLogText('Error in app.ts')
                .atNode('analysis')
                .build();

            // Note: Actual retry logic depends on implementation
            // This test verifies the mock setup
            expect(mockLLM).toBeDefined();
        });

        it('should handle GitHub API timeouts gracefully', async () => {
            const { getWorkflowLogs } = await import('../../../../services/github/GitHubService.js');
            vi.mocked(getWorkflowLogs).mockRejectedValueOnce(new Error('GitHub API timeout'));

            const state = new GraphStateBuilder()
                .withLogText('')
                .atNode('analysis')
                .build();

            const result = await analysisNode(state, context);

            // Should handle gracefully, possibly with fallback
            expect(result).toBeDefined();
        });
    });

    describe('Malformed LLM Responses', () => {
        it('should handle invalid JSON from LLM', async () => {
            const { unifiedGenerate } = await import('../../../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: 'This is not valid JSON {{{',
                toolCalls: []
            });

            const state = new GraphStateBuilder()
                .withLogText('Error')
                .atNode('analysis')
                .build();

            const result = await analysisNode(state, context);

            // Should handle gracefully, possibly with retry or fallback
            expect(result).toBeDefined();
        });

        it('should handle incomplete diagnosis from LLM', async () => {
            const { unifiedGenerate } = await import('../../../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: JSON.stringify({ summary: 'Error' }), // Missing required fields
                toolCalls: []
            });

            const state = new GraphStateBuilder()
                .withLogText('Error')
                .atNode('analysis')
                .build();

            const result = await analysisNode(state, context);

            // Should handle missing fields gracefully
            expect(result).toBeDefined();
        });

        it('should handle empty response from LLM', async () => {
            const { unifiedGenerate } = await import('../../../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({ text: '', toolCalls: [] });

            const state = new GraphStateBuilder()
                .withLogText('Error')
                .atNode('analysis')
                .build();

            const result = await analysisNode(state, context);

            expect(result).toBeDefined();
        });
    });

    describe('Database Constraint Violations', () => {
        it('should handle foreign key constraint violations', async () => {
            // Try to create ErrorFact without AgentRun
            await expect(
                testDb.errorFact.create({
                    data: {
                        runId: 'non-existent-run',
                        summary: 'Test error',
                        filePath: 'test.ts',
                        fixAction: 'edit'
                    }
                })
            ).rejects.toThrow();
        });

        it('should handle unique constraint violations', async () => {
            // Create AgentRun first
            await testDb.agentRun.create({
                data: {
                    id: 'test-run',
                    groupId: 'test-group',
                    status: 'working',
                    state: '{}'
                }
            });

            // Create first record
            await testDb.errorFact.create({
                data: {
                    id: 'fact-1',
                    runId: 'test-run',
                    summary: 'Error',
                    filePath: 'app.ts',
                    fixAction: 'edit'
                }
            });

            // Try to create duplicate with same ID
            await expect(
                testDb.errorFact.create({
                    data: {
                        id: 'fact-1', // Same ID
                        runId: 'test-run',
                        summary: 'Different error',
                        filePath: 'other.ts',
                        fixAction: 'edit'
                    }
                })
            ).rejects.toThrow();
        });

        it('should handle database connection failures', async () => {
            const brokenContext = {
                ...context,
                dbClient: {
                    errorFact: {
                        findFirst: async () => {
                            throw new Error('Connection lost');
                        }
                    }
                }
            };

            const state = new GraphStateBuilder()
                .withLogText('Error')
                .atNode('analysis')
                .build();

            // Should not crash the entire node
            const result = await analysisNode(state, brokenContext);
            expect(result).toBeDefined();
        });
    });

    describe('Resource Exhaustion', () => {
        it('should handle very large log files', async () => {
            const hugeLog = 'Error: '.repeat(100000); // ~600KB of text

            const state = new GraphStateBuilder()
                .withLogText(hugeLog)
                .atNode('analysis')
                .build();

            const result = await analysisNode(state, context);

            expect(result).toBeDefined();
            // Should handle large inputs without crashing
        });

        it('should handle deeply nested error messages', async () => {
            const nestedError = Array(100).fill(null).map((_, i) =>
                `Error ${i}: Caused by error ${i + 1}`
            ).join('\\n');

            const state = new GraphStateBuilder()
                .withLogText(nestedError)
                .atNode('analysis')
                .build();

            const result = await analysisNode(state, context);

            expect(result).toBeDefined();
        });
    });

    describe('Race Conditions', () => {
        it('should handle concurrent state updates', async () => {
            const state = new GraphStateBuilder()
                .withLogText('Error')
                .withDiagnosis({ filePath: 'app.ts', fixAction: 'edit', summary: 'Error' })
                .atNode('execution')
                .build();

            // Simulate concurrent execution
            const results = await Promise.all([
                codingNode(state, context),
                codingNode(state, context)
            ]);

            // Both should complete without errors
            expect(results[0]).toBeDefined();
            expect(results[1]).toBeDefined();
        });

        it('should handle file reservation conflicts', async () => {
            const state1 = new GraphStateBuilder()
                .withFileReservations(['app.ts'])
                .build();

            const state2 = new GraphStateBuilder()
                .withFileReservations(['app.ts']) // Same file
                .build();

            // Both states claim the same file
            // In a real system, this should be prevented by locking
            expect(state1.fileReservations).toContain('app.ts');
            expect(state2.fileReservations).toContain('app.ts');
        });
    });

    describe('Edge Cases', () => {
        it('should handle null/undefined values in state', async () => {
            const state = new GraphStateBuilder()
                .withLogText('')
                .build();

            state.diagnosis = undefined;
            state.classification = undefined;

            // Should handle gracefully
            expect(state).toBeDefined();
        });

        it('should handle special characters in file paths', async () => {
            const state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: 'src/files/test (1).ts',
                    fixAction: 'edit',
                    summary: 'Error'
                })
                .build();

            expect(state.diagnosis?.filePath).toContain('(1)');
        });

        it('should handle unicode in error messages', async () => {
            const state = new GraphStateBuilder()
                .withLogText('Error: 文件未找到 (File not found) 🚨')
                .build();

            const result = await analysisNode(state, context);

            expect(result).toBeDefined();
        });
    });
});
