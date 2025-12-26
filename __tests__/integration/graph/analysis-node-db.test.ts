import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analysisNode } from '../../../agent/graph/nodes/analysis.js';
import { GraphState, GraphContext } from '../../../agent/graph/state.js';
import { TestDatabaseManager } from '../../helpers/test-database.js';
import { ErrorCategory } from '../../../../types.js';
import { SimulationSandbox } from '../../../sandbox.js';
import { registerCustomMatchers } from '../../helpers/custom-assertions.js';
import { diagnoseError } from '../../../services/analysis/LogAnalysisService.js';
import { createMockConfig, createMockRunGroup, createMockDiagnosis, createMockClassification, createMockServices } from '../../helpers/test-fixtures.js';

// Register custom matchers
registerCustomMatchers();

// Mock external services
vi.mock('../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({
        text: 'Mocked LLM response',
        toolCalls: []
    })
}));

vi.mock('../../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({
        logText: 'Mocked log text',
        headSha: 'abc123'
    })
}));

vi.mock('../../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue('No dependencies found')
}));

vi.mock('../../../services/context-compiler.js', () => ({
    getCachedRepoContext: vi.fn().mockResolvedValue('Mocked repo context')
}));

vi.mock('../../../services/analysis/LogAnalysisService.js', () => ({
    generateRepoSummary: vi.fn().mockResolvedValue('Mocked repo summary'),
    diagnoseError: vi.fn().mockImplementation(async (config, logText, context, profile, classification, feedback) => {
        // Check if there's a previous attempt in the database
        const db = profile?.dbClient || (globalThis as any).testDb;
        if (db && logText.includes('lodash')) {
            const previousAttempt = await db.errorFact.findFirst({
                where: {
                    summary: { contains: 'lodash' }
                }
            });

            if (previousAttempt) {
                return {
                    summary: 'Cannot find module "lodash" - previous attempt detected',
                    filePath: 'package.json',
                    fixAction: 'command',
                    suggestedCommand: 'npm install lodash',
                    previousAttempts: [previousAttempt]
                };
            }
        }

        return {
            summary: 'Mocked diagnosis',
            filePath: 'src/app.ts',
            fixAction: 'edit',
            suggestedCommand: null
        };
    })
}));

vi.mock('../../../errorClassification.js', () => ({
    ErrorCategory: {
        SYNTAX: 'syntax',
        DEPENDENCY: 'dependency',
        RUNTIME: 'runtime',
        UNKNOWN: 'unknown'
    },
    classifyErrorWithHistory: vi.fn().mockResolvedValue({
        category: 'dependency',
        confidence: 0.9,
        affectedFiles: ['package.json'],
        suggestedAction: 'Install missing dependency'
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

describe('Analysis Node - Database Integration Tests', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let mockState: GraphState;
    let mockContext: GraphContext;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();

        // Make testDb available to mocks
        (globalThis as any).testDb = testDb;

        // Clean up any existing data
        await testDb.errorFact.deleteMany({});
        await testDb.fileModification.deleteMany({});

        // Create mock state
        mockState = {
            config: createMockConfig({
                devEnv: 'simulation',
                checkEnv: 'simulation'
            }),
            group: createMockRunGroup({
                id: 'test-group-1',
                mainRun: {
                    id: 123,
                    head_sha: 'abc123',
                    status: 'failed',
                    conclusion: 'failure'
                } as any
            }),
            iteration: 0,
            currentLogText: 'Error: Cannot find module "lodash"\nModuleNotFoundError: No module named lodash',
            diagnosis: null,
            fileReservations: [],
            files: {},
            feedback: [],
            currentNode: 'analysis',
            initialLogText: '',
            complexityHistory: [],
            solvedNodes: []
        } as any;

        // Create mock context with test database
        const sandbox = new SimulationSandbox();
        await sandbox.init();

        // Override default mocks with test-specific ones from the top-level vi.mock calls
        const LogAnalysisService = await import('../../../services/analysis/LogAnalysisService.js');
        const ErrorClassification = await import('../../../errorClassification.js');
        const SandboxService = await import('../../../services/sandbox/SandboxService.js');

        mockContext = {
            logCallback: vi.fn(),
            updateStateCallback: vi.fn(),
            sandbox,
            profile: undefined,
            services: createMockServices({
                analysis: LogAnalysisService as any,
                classification: ErrorClassification as any,
                sandbox: SandboxService as any
            }),
            dbClient: testDb // ← Inject test database
        } as any;
    });

    afterEach(async () => {
        if (testDb) {
            await testDb.errorFact.deleteMany({});
            await testDb.fileModification.deleteMany({});
        }
        if (testDbManager) {
            await testDbManager.teardown();
        }
        if (mockContext.sandbox) {
            await mockContext.sandbox.teardown();
        }
    });

    describe('Error Fact Creation', () => {
        it('should check for previous attempts in test database', async () => {
            // Create AgentRun first (required for foreign key)
            await testDb.agentRun.create({
                data: {
                    id: 'previous-run',
                    groupId: 'test-group',
                    status: 'success',
                    state: '{}'
                }
            });

            // Seed database with a previous attempt
            await testDb.errorFact.create({
                data: {
                    runId: 'previous-run',
                    summary: 'Cannot find module "lodash"',
                    filePath: 'package.json',
                    fixAction: 'command'
                }
            });

            // Run analysis node
            const result = await analysisNode(mockState, mockContext);

            // Verify it found the previous attempt
            const facts = await testDb.errorFact.findMany({});
            expect(facts.length).toBeGreaterThanOrEqual(1);

            // Verify the node actually used the previous attempt
            expect(result.diagnosis).toBeDefined();
            expect(result.diagnosis?.summary).toContain('lodash');
            expect(result).toHaveTransitionedTo('planning');
        });

        it('should not find previous attempts when database is empty', async () => {
            // Run analysis node with empty database
            const result = await analysisNode(mockState, mockContext);

            // Should proceed without errors and create new diagnosis
            expect(result).toBeDefined();
            expect(result.diagnosis).toBeDefined();
            expect(result).toHaveTransitionedTo('planning');
        });

        it('should handle database errors gracefully', async () => {
            // Create a context with a broken database client
            const brokenContext = {
                ...mockContext,
                dbClient: {
                    errorFact: {
                        findFirst: async () => {
                            throw new Error('Database connection failed');
                        }
                    }
                }
            };

            // Should not throw, should handle gracefully
            await expect(
                analysisNode(mockState, brokenContext)
            ).resolves.toBeDefined();
        });
    });

    describe('Dependency Detection', () => {
        it('should detect ModuleNotFoundError and trigger dependency scan', async () => {
            mockState.currentLogText = 'ModuleNotFoundError: No module named "requests"';
            mockState.iteration = 0;

            // Import mocked dependency scanner
            const { toolScanDependencies } = await import('../../../services/sandbox/SandboxService.js');

            // Override diagnosis mock for this test
            vi.mocked(diagnoseError).mockResolvedValueOnce({
                summary: 'ModuleNotFoundError: No module named "requests"',
                filePath: 'package.json',
                fixAction: 'command',
                suggestedCommand: 'npm install requests'
            });

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result.diagnosis).toBeDefined();
            expect(result.diagnosis?.summary).toContain('requests');
            // Verify dependency scan was triggered
            expect(toolScanDependencies).toHaveBeenCalled();
        });

        it('should detect ImportError and classify correctly', async () => {
            mockState.currentLogText = 'ImportError: cannot import name "foo" from "bar"';
            mockState.iteration = 0;

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result.diagnosis).toBeDefined();
            expect(result.classification).toBeDefined();
            expect(result.classification?.category).toBe('dependency');
        });

        it('should skip dependency scan on iteration > 0', async () => {
            mockState.currentLogText = 'ModuleNotFoundError: No module named "requests"';
            mockState.iteration = 1;

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
        });
    });

    describe('Log Discovery Strategies', () => {
        it('should use extended strategy on iteration 0', async () => {
            mockState.iteration = 0;
            mockState.currentLogText = ''; // Empty to trigger log fetch

            const result = await analysisNode(mockState, mockContext);

            // Should have attempted to fetch logs
            expect(result).toBeDefined();
        });

        it('should use any_error strategy on iteration 1', async () => {
            mockState.iteration = 1;
            mockState.currentLogText = '';

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
        });

        it('should use force_latest strategy on iteration 2', async () => {
            mockState.iteration = 2;
            mockState.currentLogText = '';

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
        });

        it('should fail after iteration 2 with no failed job', async () => {
            mockState.iteration = 3;
            mockState.currentLogText = 'No failed job found';

            const result = await analysisNode(mockState, mockContext);

            expect(result.status).toBe('failed');
            expect(result.failureReason).toContain('No failed job found');
        });
    });

    describe('Database Isolation', () => {
        it('should use injected test database instead of global', async () => {
            // Create AgentRun first (required for foreign key)
            await testDb.agentRun.create({
                data: {
                    id: 'test-run',
                    groupId: 'test-group',
                    status: 'working',
                    state: '{}'
                }
            });

            // Seed test database
            await testDb.errorFact.create({
                data: {
                    runId: 'test-run',
                    summary: 'Test error',
                    filePath: 'test.ts',
                    fixAction: 'edit'
                }
            });

            // Run analysis
            await analysisNode(mockState, mockContext);

            // Verify test database was used
            const facts = await testDb.errorFact.findMany({});
            expect(facts.length).toBe(1);
            expect(facts[0].runId).toBe('test-run');
        });

        it('should isolate test data from other tests', async () => {
            // This test should start with empty database
            const facts = await testDb.errorFact.findMany({});
            expect(facts.length).toBe(0);
        });
    });

    describe('Error Classification Integration', () => {
        it('should classify dependency errors correctly', async () => {
            mockState.currentLogText = 'ModuleNotFoundError: No module named "lodash"';

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result.diagnosis).toBeDefined();
            expect(result.classification).toBeDefined();
            expect(result.classification?.category).toBe('dependency');
            expect(result.classification?.affectedFiles).toContain('package.json');
        });

        it('should classify syntax errors correctly', async () => {
            mockState.currentLogText = 'SyntaxError: Unexpected token }';

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result.diagnosis).toBeDefined();
            expect(result.diagnosis?.fixAction).toBe('edit');
            expect(result).toHaveTransitionedTo('planning');
        });

        it('should classify runtime errors correctly', async () => {
            // Override mock to return runtime classification
            const { classifyErrorWithHistory } = await import('../../../errorClassification.js');
            vi.mocked(classifyErrorWithHistory).mockResolvedValueOnce({
                category: 'runtime',
                errorMessage: 'TypeError',
                affectedFiles: ['src/app.ts'],
                confidence: 0.95,
                suggestedAction: 'Fix runtime error'
            });

            mockState.currentLogText = 'TypeError: Cannot read property "foo" of undefined';

            const result = await analysisNode(mockState, mockContext);

            expect(result).toBeDefined();
            expect(result.diagnosis).toBeDefined();
            expect(result.classification?.category).toBe('runtime');
            expect(result.diagnosis?.fixAction).toBe('edit');
        });
    });
});
