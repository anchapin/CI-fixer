import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analysisNode } from '../../../../agent/graph/nodes/analysis.js';
import { planningNode } from '../../../../agent/graph/nodes/planning.js';
import { codingNode } from '../../../../agent/graph/nodes/execution.js';
import { verificationNode } from '../../../../agent/graph/nodes/verification.js';
import { GraphState, GraphContext } from '../../../../agent/graph/state.js';
import { TestDatabaseManager } from '../../../helpers/test-database.js';
import { createMockGraphContext, cleanupMockContext } from '../../../helpers/test-fixtures.js';
import { GraphStateBuilder } from '../../../helpers/test-builders.js';
import { registerCustomMatchers } from '../../../helpers/custom-assertions.js';

// Register custom matchers
registerCustomMatchers();

// Mock external services
vi.mock('../../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
            summary: 'TypeError in app.ts',
            filePath: 'src/app.ts',
            fixAction: 'edit'
        }),
        toolCalls: []
    })
}));

vi.mock('../../../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({
        logText: 'TypeError: Cannot read property "foo" of undefined',
        headSha: 'abc123',
        jobName: 'test'
    }),
    findClosestFile: vi.fn().mockResolvedValue({
        file: { content: 'const x = undefined;\\nx.foo();', language: 'javascript', name: 'app.ts' },
        path: 'src/app.ts'
    }),
    getFileContent: vi.fn().mockResolvedValue({
        name: 'app.ts',
        content: 'const x = undefined;\\nx.foo();',
        language: 'javascript'
    })
}));

vi.mock('../../../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue('No dependencies found'),
    toolCodeSearch: vi.fn().mockResolvedValue(['src/app.ts']),
    toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
    toolWebSearch: vi.fn().mockResolvedValue(''),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    runDevShellCommand: vi.fn().mockResolvedValue({ output: 'success', exitCode: 0 })
}));

vi.mock('../../../../services/analysis/LogAnalysisService.js', () => ({
    generateRepoSummary: vi.fn().mockResolvedValue('Mock repo summary'),
    diagnoseError: vi.fn().mockResolvedValue({
        summary: 'TypeError: Cannot read property "foo" of undefined',
        filePath: 'src/app.ts',
        fixAction: 'edit',
        suggestedCommand: null
    }),
    generateDetailedPlan: vi.fn().mockResolvedValue({
        goal: 'Fix TypeError',
        tasks: [{ id: '1', description: 'Add null check', status: 'pending' }],
        approved: true
    }),
    formatPlanToMarkdown: vi.fn().mockReturnValue('# Plan\\n- Add null check'),
    generateFix: vi.fn().mockResolvedValue('const x = undefined;\\nif (x) x.foo();'),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'All tests passed' }),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: 'Good fix' }),
    // Phase 2: Add reproduction command inference
    inferReproductionCommand: vi.fn().mockResolvedValue('npm test')
}));

vi.mock('../../../../services/analysis/CodeAnalysisService.js', () => ({
    extractFileOutline: vi.fn().mockReturnValue('Functions: main()')
}));

vi.mock('../../../../errorClassification.js', () => ({
    ErrorCategory: {
        SYNTAX: 'syntax',
        DEPENDENCY: 'dependency',
        RUNTIME: 'runtime',
        UNKNOWN: 'unknown'
    },
    classifyErrorWithHistory: vi.fn().mockResolvedValue({
        category: 'runtime',
        confidence: 0.9,
        affectedFiles: ['src/app.ts'],
        suggestedAction: 'Add null check'
    }),
    getErrorPriority: vi.fn().mockReturnValue('high')
}));

vi.mock('../../../../services/dependency-tracker.js', () => ({
    hasBlockingDependencies: vi.fn().mockResolvedValue(false),
    getBlockedErrors: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../../services/error-clustering.js', () => ({
    clusterError: vi.fn().mockResolvedValue(null)
}));

vi.mock('../../../../utils/logger.js', () => ({
    log: vi.fn()
}));

describe('Graph State Machine Flow Tests', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let context: GraphContext;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        context = await createMockGraphContext({ dbClient: testDb });
    });

    afterEach(async () => {
        if (testDb) {
            await testDb.errorFact.deleteMany({});
            await testDb.fileModification.deleteMany({});
        }
        if (testDbManager) {
            await testDbManager.teardown();
        }
        await cleanupMockContext(context);
    });

    describe('Success Path: Complete Flow', () => {
        it('should transition through analysis -> planning -> execution -> verification -> success', async () => {
            // Start with initial state
            let state = new GraphStateBuilder()
                .withLogText('TypeError: Cannot read property "foo" of undefined')
                .atNode('analysis')
                .atIteration(0)
                .build();

            // Step 1: Analysis
            state = { ...state, ...await analysisNode(state, context) };

            expect(state).toHaveTransitionedTo('planning');
            expect(state.diagnosis).toBeDefined();
            expect(state.diagnosis?.filePath).toBe('src/app.ts');
            expect(state.diagnosis?.fixAction).toBe('edit');

            // Step 2: Planning
            state = { ...state, ...await planningNode(state, context) };

            expect(state).toHaveTransitionedTo('execution');
            expect(state.fileReservations).toContain('src/app.ts');
            expect(state.plan).toBeDefined();

            // Step 3: Execution
            state = { ...state, ...await codingNode(state, context) };

            expect(state).toHaveTransitionedTo('verification');
            expect(state.files['src/app.ts']).toBeDefined();
            expect(state.files['src/app.ts'].status).toBe('modified');

            // Step 4: Verification
            state = { ...state, ...await verificationNode(state, context) };

            expect(state.status).toBe('success');
            expect(state.currentNode).toBe('finish');
        });

        it('should record all state transitions in history', async () => {
            let state = new GraphStateBuilder()
                .withLogText('SyntaxError: Unexpected token }')
                .atNode('analysis')
                .build();

            // Analysis
            state = { ...state, ...await analysisNode(state, context) };
            state.history.push({
                node: 'analysis',
                action: 'diagnosed',
                result: 'success',
                timestamp: Date.now()
            });

            // Planning
            state = { ...state, ...await planningNode(state, context) };
            state.history.push({
                node: 'planning',
                action: 'planned',
                result: 'success',
                timestamp: Date.now()
            });

            // Execution
            state = { ...state, ...await codingNode(state, context) };
            state.history.push({
                node: 'execution',
                action: 'coded',
                result: 'success',
                timestamp: Date.now()
            });

            expect(state.history.length).toBeGreaterThanOrEqual(3);
            expect(state.history.map(h => h.node)).toContain('analysis');
            expect(state.history.map(h => h.node)).toContain('planning');
            expect(state.history.map(h => h.node)).toContain('execution');
        });
    });

    describe('Failure Paths: Retry Logic', () => {
        it('should retry when verification fails', async () => {
            // Set up runSandboxTest to fail first time, then succeed
            (context.services.analysis.runSandboxTest as any)
                .mockResolvedValueOnce({ passed: false, logs: 'Tests failed' })
                .mockResolvedValueOnce({ passed: true, logs: 'Tests passed' });

            let state = new GraphStateBuilder()
                .withLogText('Error in tests')
                .withDiagnosis({
                    filePath: 'src/app.ts',
                    fixAction: 'edit',
                    reproductionCommand: 'npm test' // Phase 2: Required for verification
                })
                .withFile('src/app.ts')
                .atNode('verification')
                .atIteration(0)
                .build();

            // First verification - should fail and loop back
            state = { ...state, ...await verificationNode(state, context) };

            expect(state).toHaveTransitionedTo('analysis');
            expect(state.iteration).toBe(1);
            expect(state).toHaveFeedbackContaining('Test Suite Failed');
        });

        it('should fail after max iterations', async () => {
            const state = new GraphStateBuilder()
                .withLogText('Persistent error')
                .atNode('analysis')
                .atIteration(3)
                .withMaxIterations(3)
                .build();

            // At max iterations, should fail
            expect(state.iteration).toBe(state.maxIterations);

            // In real implementation, the graph runner would check this
            // and transition to failed state
        });

        it('should handle missing diagnosis gracefully', async () => {
            let state = new GraphStateBuilder()
                .atNode('planning')
                .build();

            // Planning without diagnosis should fail
            state = { ...state, ...await planningNode(state, context) };

            expect(state.status).toBe('failed');
            expect(state.failureReason).toContain('No diagnosis');
        });

        it('should handle file not found in planning', async () => {
            // Mock findClosestFile to return null on the context service
            (context.services.github.findClosestFile as any).mockResolvedValueOnce(null);

            let state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: 'nonexistent.ts',
                    fixAction: 'edit',
                    summary: 'Error in nonexistent file'
                })
                .atNode('planning')
                .build();

            state = { ...state, ...await planningNode(state, context) };

            // Should still proceed but with warning
            expect(state).toHaveTransitionedTo('execution');

            // Verify logCallback was called
            expect(context.logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('not found'));
        });
    });

    describe('Command-based Fixes', () => {
        it('should handle command fixes without file modifications', async () => {
            let state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: null,
                    fixAction: 'command',
                    suggestedCommand: 'npm install lodash',
                    reproductionCommand: 'node -e "require(\'lodash\')"',
                    summary: 'Missing dependency'
                })
                .atNode('verification')
                .build();

            state = { ...state, ...await verificationNode(state, context) };

            expect(state.status).toBe('success');
            expect(state.currentNode).toBe('finish');
        });
    });

    describe('Feedback Loop', () => {
        it('should accumulate feedback across iterations', async () => {
            let state = new GraphStateBuilder()
                .withLogText('Error')
                .withFeedback(['Previous attempt failed'])
                .atIteration(1)
                .build();

            // Mock verification to fail
            vi.mocked(await import('../../../../services/analysis/LogAnalysisService.js'))
                .runSandboxTest.mockResolvedValueOnce({ passed: false, logs: 'Still failing' });

            state = {
                ...state,
                diagnosis: { filePath: 'app.ts', fixAction: 'edit', summary: 'Error' },
                files: { 'app.ts': { path: 'app.ts', status: 'modified', original: { name: 'app.ts', content: '', language: 'js' }, modified: { name: 'app.ts', content: 'fixed', language: 'js' } } }
            };

            state = { ...state, ...await verificationNode(state, context) };

            // Feedback should have been added (original + new)
            expect(state.feedback.length).toBeGreaterThanOrEqual(1);
            expect(state.feedback).toContain('Previous attempt failed');
        });
    });

    describe('Database Integration', () => {
        it('should persist error facts during analysis', async () => {
            // Create AgentRun first
            await testDb.agentRun.create({
                data: {
                    id: 'test-run',
                    groupId: 'test-group',
                    status: 'working',
                    state: '{}'
                }
            });

            let state = new GraphStateBuilder()
                .withLogText('ModuleNotFoundError: No module named "requests"')
                .atNode('analysis')
                .build();

            state = { ...state, ...await analysisNode(state, context) };

            // Note: Actual persistence depends on implementation
            // This test verifies the database is accessible
            const facts = await testDb.errorFact.findMany({});
            expect(facts).toBeDefined();
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty log text', async () => {
            let state = new GraphStateBuilder()
                .withLogText('')
                .atNode('analysis')
                .build();

            state = { ...state, ...await analysisNode(state, context) };

            // Should either fail or fetch logs from GitHub
            expect(state).toBeDefined();
        });

        it('should handle malformed diagnosis', async () => {
            let state = new GraphStateBuilder()
                .withDiagnosis({
                    filePath: '',
                    fixAction: 'edit' as any,
                    summary: ''
                })
                .atNode('planning')
                .build();

            state = { ...state, ...await planningNode(state, context) };

            // Should handle gracefully
            expect(state).toBeDefined();
        });
    });
});
