import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Google GenAI before importing any services
vi.mock('@google/genai', () => ({
    GoogleGenAI: class {
        constructor() {}
        get models() {
            return {
                generateContent: vi.fn().mockImplementation(({model}) => {
                    // Return different responses based on the model
                    if (model?.includes('flash')) {
                        return Promise.resolve({
                            text: JSON.stringify({
                                goal: 'Fix error in app.ts',
                                tasks: [{
                                    id: '1',
                                    description: 'Fix the error in app.ts',
                                    status: 'pending'
                                }],
                                approved: true
                            }),
                            candidates: [{
                                content: {
                                    parts: []
                                }
                            }]
                        });
                    }

                    return Promise.resolve({
                        text: JSON.stringify({
                            summary: 'Test error',
                            filePath: 'app.ts',
                            fixAction: 'edit',
                            suggestedCommand: null
                        }),
                        candidates: [{
                            content: {
                                parts: []
                            }
                        }]
                    });
                })
            };
        }
    }
}));

import { analysisNode } from '../../agent/graph/nodes/analysis.js';
import { planningNode } from '../../agent/graph/nodes/planning.js';
import { codingNode } from '../../agent/graph/nodes/execution.js';
import { verificationNode } from '../../agent/graph/nodes/verification.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { createMockGraphContext, cleanupMockContext } from '../helpers/test-fixtures.js';
import { GraphStateBuilder } from '../helpers/test-builders.js';

// Mock external services for consistent timing
const mockUnifiedGenerate = vi.fn().mockImplementation((config, params) => {
    // Return different responses based on the model being requested
    if (params.model?.includes('flash') || config.llmModel?.includes('flash')) {
        return Promise.resolve({
            text: JSON.stringify({
                goal: 'Fix error in app.ts',
                tasks: [{
                    id: '1',
                    description: 'Fix the error in app.ts',
                    status: 'pending',
                    tools: ['syntax_validator']
                }],
                approved: true
            }),
            toolCalls: []
        });
    }

    return Promise.resolve({
        text: JSON.stringify({
            summary: 'Test error',
            filePath: 'app.ts',
            fixAction: 'edit',
            suggestedCommand: null
        }),
        toolCalls: []
    });
});

vi.mock('../../../services/llm/LLMService', () => ({
    unifiedGenerate: mockUnifiedGenerate
}));

vi.mock('../../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({
        logText: 'Error message',
        headSha: 'abc123',
        jobName: 'test'
    }),
    findClosestFile: vi.fn().mockResolvedValue({
        file: { content: 'code', language: 'typescript', name: 'app.ts' },
        path: 'src/app.ts'
    }),
    getFileContent: vi.fn().mockResolvedValue({
        name: 'app.ts',
        content: 'code',
        language: 'typescript'
    })
}));

vi.mock('../../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue('No dependencies'),
    toolCodeSearch: vi.fn().mockResolvedValue(['src/app.ts']),
    toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
    toolWebSearch: vi.fn().mockResolvedValue(''),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true })
}));

vi.mock('../../../services/analysis/LogAnalysisService.js', () => ({
    generateRepoSummary: vi.fn().mockResolvedValue('Repo summary'),
    diagnoseError: vi.fn().mockResolvedValue({
        summary: 'Error',
        filePath: 'app.ts',
        fixAction: 'edit',
        suggestedCommand: null
    }),
    generateDetailedPlan: vi.fn().mockResolvedValue({
        goal: 'Fix error',
        tasks: [{
            id: '1',
            description: 'Fix the error in app.ts',
            status: 'pending'
        }],
        approved: true
    }),
    formatPlanToMarkdown: vi.fn().mockReturnValue('# Plan'),
    generateFix: vi.fn().mockResolvedValue('fixed code'),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'OK' }),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: 'Good' })
}));

vi.mock('../../../errorClassification.js', () => ({
    ErrorCategory: {
        SYNTAX: 'syntax',
        DEPENDENCY: 'dependency',
        RUNTIME: 'runtime',
        UNKNOWN: 'unknown'
    },
    classifyErrorWithHistory: vi.fn().mockResolvedValue({
        category: 'runtime',
        confidence: 0.9,
        affectedFiles: ['app.ts'],
        suggestedAction: 'Fix'
    }),
    getErrorPriority: vi.fn().mockReturnValue('high')
}));

vi.mock('../../../services/dependency-tracker.js', () => ({
    hasBlockingDependencies: vi.fn().mockResolvedValue(false),
    getBlockedErrors: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../services/error-clustering.js', () => ({
    clusterError: vi.fn().mockResolvedValue(null)
}));

/**
 * Performance Benchmark Tests
 * 
 * These tests measure the performance of critical paths in the agent.
 * They help identify performance regressions and ensure the agent
 * completes operations within acceptable time limits.
 */
describe('Performance Benchmarks', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let context: any;

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

    describe('Node Performance', () => {
        it('should complete analysis node in < 5 seconds', async () => {
            const state = new GraphStateBuilder()
                .withLogText('Error: Cannot find module')
                .atNode('analysis')
                .build();

            const start = Date.now();
            await analysisNode(state, context);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(5000);
            console.log(`Analysis node completed in ${duration}ms`);
        });

        it('should complete planning node in < 3 seconds', async () => {
            const state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: 'app.ts',
                    fixAction: 'edit',
                    summary: 'Error'
                })
                .atNode('planning')
                .build();

            const start = Date.now();
            await planningNode(state, context);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(3000);
            console.log(`Planning node completed in ${duration}ms`);
        });

        it('should complete execution node in < 5 seconds', async () => {
            const state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: 'app.ts',
                    fixAction: 'edit',
                    summary: 'Error'
                })
                .withFileReservations(['app.ts'])
                .atNode('execution')
                .build();

            const start = Date.now();
            await codingNode(state, context);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(5000);
            console.log(`Execution node completed in ${duration}ms`);
        });

        it('should complete verification node in < 3 seconds', async () => {
            const state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: 'app.ts',
                    fixAction: 'edit',
                    summary: 'Error'
                })
                .withFile('app.ts')
                .atNode('verification')
                .build();

            const start = Date.now();
            await verificationNode(state, context);
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(3000);
            console.log(`Verification node completed in ${duration}ms`);
        });
    });

    describe('Full Flow Performance', () => {
        it('should complete full flow in < 20 seconds', async () => {
            let state = new GraphStateBuilder()
                .withLogText('Error: Cannot find module')
                .atNode('analysis')
                .build();

            const start = Date.now();

            // Analysis
            state = { ...state, ...await analysisNode(state, context) };

            // Planning
            state = { ...state, ...await planningNode(state, context) };

            // Execution
            state = { ...state, ...await codingNode(state, context) };

            // Verification
            state = { ...state, ...await verificationNode(state, context) };

            const duration = Date.now() - start;

            expect(duration).toBeLessThan(20000);
            console.log(`Full flow completed in ${duration}ms`);
        });

        it('should handle multiple iterations efficiently', async () => {
            const iterations = 3;
            let state = new GraphStateBuilder()
                .withLogText('Error')
                .atNode('analysis')
                .build();

            const start = Date.now();

            for (let i = 0; i < iterations; i++) {
                state = { ...state, iteration: i };
                state = { ...state, ...await analysisNode(state, context) };
            }

            const duration = Date.now() - start;
            const avgPerIteration = duration / iterations;

            expect(avgPerIteration).toBeLessThan(5000);
            console.log(`${iterations} iterations completed in ${duration}ms (avg: ${avgPerIteration}ms)`);
        });
    });

    describe('Database Performance', () => {
        it('should create error facts quickly', async () => {
            await testDb.agentRun.create({
                data: {
                    id: 'perf-test',
                    groupId: 'group-1',
                    status: 'working',
                    state: '{}'
                }
            });

            const count = 100;
            const start = Date.now();

            for (let i = 0; i < count; i++) {
                await testDb.errorFact.create({
                    data: {
                        runId: 'perf-test',
                        summary: `Error ${i}`,
                        filePath: 'app.ts',
                        fixAction: 'edit'
                    }
                });
            }

            const duration = Date.now() - start;
            const avgPerInsert = duration / count;

            expect(avgPerInsert).toBeLessThan(200); // < 200ms per insert
            console.log(`${count} inserts in ${duration}ms (avg: ${avgPerInsert}ms)`);
        });

        it('should query error facts efficiently', async () => {
            await testDb.agentRun.create({
                data: {
                    id: 'query-test',
                    groupId: 'group-1',
                    status: 'working',
                    state: '{}'
                }
            });

            // Create test data
            for (let i = 0; i < 100; i++) {
                await testDb.errorFact.create({
                    data: {
                        runId: 'query-test',
                        summary: `Error ${i}`,
                        filePath: 'app.ts',
                        fixAction: 'edit'
                    }
                });
            }

            const start = Date.now();
            const facts = await testDb.errorFact.findMany({
                where: { runId: 'query-test' }
            });
            const duration = Date.now() - start;

            expect(facts.length).toBe(100);
            expect(duration).toBeLessThan(100); // < 100ms for 100 records
            console.log(`Query of 100 records in ${duration}ms`);
        });
    });

    describe('Concurrent Operations', () => {
        it('should handle concurrent node executions', async () => {
            const concurrency = 5;
            const states = Array.from({ length: concurrency }, (_, i) =>
                new GraphStateBuilder()
                    .withLogText(`Error ${i}`)
                    .atNode('analysis')
                    .build()
            );

            const start = Date.now();

            const results = await Promise.all(
                states.map(state => analysisNode(state, context))
            );

            const duration = Date.now() - start;

            expect(results.length).toBe(concurrency);
            expect(duration).toBeLessThan(10000); // Should not be 5x slower
            console.log(`${concurrency} concurrent executions in ${duration}ms`);
        });

        it('should handle concurrent database writes', async () => {
            await testDb.agentRun.create({
                data: {
                    id: 'concurrent-test',
                    groupId: 'group-1',
                    status: 'working',
                    state: '{}'
                }
            });

            const concurrency = 10;
            const start = Date.now();

            await Promise.all(
                Array.from({ length: concurrency }, (_, i) =>
                    testDb.errorFact.create({
                        data: {
                            runId: 'concurrent-test',
                            summary: `Error ${i}`,
                            filePath: 'app.ts',
                            fixAction: 'edit'
                        }
                    })
                )
            );

            const duration = Date.now() - start;

            const facts = await testDb.errorFact.findMany({
                where: { runId: 'concurrent-test' }
            });

            expect(facts.length).toBe(concurrency);
            expect(duration).toBeLessThan(3000); // < 3s for 10 concurrent writes
            console.log(`${concurrency} concurrent writes in ${duration}ms`);
        });
    });

    describe('Memory Usage', () => {
        it('should handle large state objects efficiently', async () => {
            const largeLog = 'Error: '.repeat(10000); // ~70KB

            const state = new GraphStateBuilder()
                .withLogText(largeLog)
                .atNode('analysis')
                .build();

            const start = Date.now();
            const result = await analysisNode(state, context);
            const duration = Date.now() - start;

            expect(result).toBeDefined();
            expect(duration).toBeLessThan(10000);
            console.log(`Large state (${largeLog.length} chars) processed in ${duration}ms`);
        });

        it('should handle many file reservations', async () => {
            const fileCount = 50;
            const files = Array.from({ length: fileCount }, (_, i) => `file${i}.ts`);

            const state = new GraphStateBuilder()
                .withFileReservations(files)
                .withDiagnosis({
                    filePath: 'file0.ts',
                    fixAction: 'edit',
                    summary: 'Error'
                })
                .atNode('planning')
                .build();

            const start = Date.now();
            const result = await planningNode(state, context);
            const duration = Date.now() - start;

            expect(result).toBeDefined();
            expect(duration).toBeLessThan(5000);
            console.log(`${fileCount} file reservations processed in ${duration}ms`);
        });
    });
});
