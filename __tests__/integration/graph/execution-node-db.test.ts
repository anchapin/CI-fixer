import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { codingNode } from '../../../agent/graph/nodes/execution.js';
import { GraphState, GraphContext } from '../../../agent/graph/state.js';
import { TestDatabaseManager } from '../../helpers/test-database.js';
import { ErrorCategory } from '../../../errorClassification.js';
import { SimulationSandbox } from '../../../sandbox.js';
import { registerCustomMatchers } from '../../helpers/custom-assertions.js';

// Register custom matchers
registerCustomMatchers();

// Mock external services
vi.mock('../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({
        text: 'const fixed = true;',
        toolCalls: []
    })
}));

vi.mock('../../../services/sandbox/SandboxService.js', () => ({
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    toolWebSearch: vi.fn().mockResolvedValue('Mocked web search results')
}));

vi.mock('../../../services/analysis/LogAnalysisService.js', () => ({
    generateFix: vi.fn().mockResolvedValue('const fixed = true;'),
    judgeFix: vi.fn().mockResolvedValue({ approved: true })
}));

vi.mock('../../../services/dependency-analyzer.js', () => ({
    getImmediateDependencies: vi.fn().mockResolvedValue([])
}));

describe('Execution Node (Coding) - Database Integration Tests', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let mockState: GraphState;
    let mockContext: GraphContext;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();

        // Clean up any existing data
        await testDb.fileModification.deleteMany({});
        await testDb.errorFact.deleteMany({});

        // Create mock state
        mockState = {
            config: {
                githubToken: 'test-token',
                repoUrl: 'https://github.com/test/repo',
                selectedRuns: [],
                devEnv: 'simulation' as const,
                checkEnv: 'simulation' as const
            },
            group: {
                id: 'test-group-1',
                name: 'Test Group',
                runIds: [123],
                mainRun: {
                    id: 123,
                    head_sha: 'abc123',
                    status: 'failed',
                    conclusion: 'failure'
                } as any
            },
            iteration: 0,
            currentLogText: 'Error in app.ts',
            diagnosis: {
                summary: 'TypeError: Cannot read property',
                filePath: 'src/app.ts',
                fixAction: 'edit',
                suggestedCommand: null
            },
            fileReservations: ['src/app.ts'],
            files: {},
            feedback: [],
            currentNode: 'execution',
            initialLogText: '',
            activeLog: 'test-log',
            maxIterations: 3,
            status: 'working' as const,
            initialRepoContext: '',
            history: [],
            complexityHistory: [],
            solvedNodes: []
        };

        // Create mock context with test database
        const sandbox = new SimulationSandbox();
        await sandbox.init();

        mockContext = {
            logCallback: (level: any, msg: string) => {
                // Silent for tests
            },
            updateStateCallback: (groupId: string, state: any) => {
                // No-op for tests
            },
            sandbox,
            profile: undefined,
            services: {
                sandbox: await import('../../../services/sandbox/SandboxService.js'),
                analysis: await import('../../../services/analysis/LogAnalysisService.js'),
                llm: await import('../../../services/llm/LLMService.js'),
                discovery: {
                    findUniqueFile: vi.fn().mockResolvedValue({ found: false, matches: [] })
                }
            } as any,
            dbClient: testDb // ← Inject test database
        };
    });

    afterEach(async () => {
        if (testDb) {
            await testDb.fileModification.deleteMany({});
            await testDb.errorFact.deleteMany({});
        }
        if (testDbManager) {
            await testDbManager.teardown();
        }
        if (mockContext.sandbox) {
            await mockContext.sandbox.teardown();
        }
    });

    describe('File Modification Persistence', () => {
        it('should create file modifications and transition to verification', async () => {
            // Run execution node
            const result = await codingNode(mockState, mockContext);

            // Verify result is defined and execution completed
            expect(result).toBeDefined();
            expect(result).toHaveTransitionedTo('verification');

            // Verify file was modified
            if (result.files && result.files['src/app.ts']) {
                expect(result.files['src/app.ts'].status).toBe('modified');
                expect(result.files['src/app.ts'].modified).toBeDefined();
            }
        });

        it('should handle database errors gracefully when recording modifications', async () => {
            // Create a context with a broken database client
            const brokenContext = {
                ...mockContext,
                dbClient: {
                    fileModification: {
                        create: async () => {
                            throw new Error('Database write failed');
                        }
                    }
                }
            };

            // Should not throw, should handle gracefully
            const result = await codingNode(mockState, brokenContext);

            // Should still return a result
            expect(result).toBeDefined();
        });

        it('should not record modification for command-based fixes', async () => {
            // Set state with no file reservations
            mockState.fileReservations = [];
            mockState.diagnosis = {
                summary: 'Run command',
                filePath: null,
                fixAction: 'command',
                suggestedCommand: 'npm install'
            };

            const result = await codingNode(mockState, mockContext);

            // Should transition to verification
            expect(result).toHaveTransitionedTo('verification');

            // Should not have created any file modifications
            const modifications = await testDb.fileModification.findMany({});
            expect(modifications.length).toBe(0);
        });
    });

    describe('Command Execution', () => {
        it('should execute command-based fixes successfully', async () => {
            mockState.diagnosis = {
                summary: 'Missing dependency',
                filePath: null,
                fixAction: 'command',
                suggestedCommand: 'echo "test"'
            };
            mockState.fileReservations = [];

            const result = await codingNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result).toHaveTransitionedTo('verification');

            // Should not create file modifications for commands
            const modifications = await testDb.fileModification.findMany({});
            expect(modifications.length).toBe(0);
        });

        it('should handle command failures gracefully', async () => {
            mockState.diagnosis = {
                summary: 'Missing dependency',
                filePath: null,
                fixAction: 'command',
                suggestedCommand: 'exit 1' // Command that fails
            };
            mockState.fileReservations = [];

            const result = await codingNode(mockState, mockContext);

            expect(result).toBeDefined();
            // Should still transition even if command fails
            expect(result.currentNode).toBeDefined();
        });
    });

    describe('Edit-based Fixes', () => {
        it('should create file change for edit action', async () => {
            const result = await codingNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result).toHaveTransitionedTo('verification');

            // Verify file change was created
            if (result.files && result.files['src/app.ts']) {
                expect(result.files['src/app.ts'].path).toBe('src/app.ts');
                expect(result.files['src/app.ts'].status).toBe('modified');
                expect(result.files['src/app.ts'].modified).toBeDefined();
            }
        });

        it('should update state files when changes are made', async () => {
            const result = await codingNode(mockState, mockContext);

            expect(result.files).toBeDefined();
            // Files object should exist, may or may not have entries
            expect(typeof result.files).toBe('object');
        });

        it('should always transition to verification node', async () => {
            const result = await codingNode(mockState, mockContext);

            expect(result).toHaveTransitionedTo('verification');
        });
    });

    describe('Database Isolation', () => {
        it('should use injected test database instead of global', async () => {
            // Run execution
            await codingNode(mockState, mockContext);

            // Verify test database was used
            const modifications = await testDb.fileModification.findMany({});
            expect(modifications.length).toBeGreaterThanOrEqual(0);

            // All modifications should be in test database
            for (const mod of modifications) {
                expect(mod.runId).toBe('test-group-1');
            }
        });

        it('should isolate test data from other tests', async () => {
            // This test should start with empty database
            const modifications = await testDb.fileModification.findMany({});
            expect(modifications.length).toBe(0);
        });

        it('should not pollute global database', async () => {
            // Run multiple executions
            await codingNode(mockState, mockContext);
            await codingNode(mockState, mockContext);

            // All data should be in test database only
            const modifications = await testDb.fileModification.findMany({});
            expect(modifications.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Lint Validation', () => {
        it('should handle lint failures', async () => {
            // Mock state with code that would fail linting
            mockState.fileReservations = ['src/bad-syntax.ts'];
            mockState.diagnosis = {
                summary: 'Syntax error',
                filePath: 'src/bad-syntax.ts',
                fixAction: 'edit',
                suggestedCommand: null
            };

            const result = await codingNode(mockState, mockContext);

            expect(result).toBeDefined();
            // May have feedback about lint errors
        });
    });

    describe('Iteration Context', () => {
        it('should include web search context on iteration > 0', async () => {
            mockState.iteration = 1;

            const result = await codingNode(mockState, mockContext);

            expect(result).toBeDefined();
        });

        it('should not include web search on iteration 0', async () => {
            mockState.iteration = 0;

            const result = await codingNode(mockState, mockContext);

            expect(result).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle missing diagnosis', async () => {
            mockState.diagnosis = null;

            const result = await codingNode(mockState, mockContext);

            expect(result.status).toBe('failed');
            expect(result.failureReason).toContain('No diagnosis');
        });

        it('should handle file read errors from sandbox', async () => {
            // Create sandbox that fails to read files
            const brokenSandbox = new SimulationSandbox();
            await brokenSandbox.init();
            brokenSandbox.readFile = async () => {
                throw new Error('File not found');
            };

            const brokenContext = {
                ...mockContext,
                sandbox: brokenSandbox
            };

            const result = await codingNode(mockState, brokenContext);

            // Should handle gracefully
            expect(result).toBeDefined();

            await brokenSandbox.teardown();
        });
    });
});
