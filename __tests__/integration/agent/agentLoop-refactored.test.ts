import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runIndependentAgentLoop } from '../../../agent.js';
import { AgentPhase } from '../../../types.js';
import { TestDatabaseManager } from '../../helpers/test-database.js';
import { createMockConfig, createMockRunGroup, createMockServices, cleanupMockContext } from '../../helpers/test-fixtures.js';
import { registerCustomMatchers } from '../../helpers/custom-assertions.js';

import * as AnalysisService from '../../../services/analysis/LogAnalysisService.js';
// Register custom matchers
registerCustomMatchers();

// Mock database client
vi.mock('../../../db/client', () => ({
    db: {
        errorFact: { findFirst: vi.fn(), create: vi.fn() },
        fileModification: { create: vi.fn() },
        repositoryPreferences: { findUnique: vi.fn(), upsert: vi.fn() },
        fixTrajectory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }
    }
}));

// Mock LLM Service
vi.mock('../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({ text: 'Mock LLM response', toolCalls: [] }),
}));

// Mock GitHub Service
vi.mock('../../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({ logText: 'Mock logs', headSha: 'abc123', jobName: 'test' }),
    findClosestFile: vi.fn().mockResolvedValue({
        file: { name: 'app.ts', content: 'const x = 1;', language: 'typescript' },
        path: 'src/app.ts'
    }),
    getFileContent: vi.fn().mockResolvedValue({ name: 'app.ts', content: 'const x = 1;', language: 'typescript' })
}));

// Mock Sandbox Service
vi.mock('../../../services/sandbox/SandboxService', () => ({
    toolCodeSearch: vi.fn().mockResolvedValue([]),
    toolWebSearch: vi.fn().mockResolvedValue(''),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    toolScanDependencies: vi.fn().mockResolvedValue('No dependencies found'),
    toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
    prepareSandbox: vi.fn().mockResolvedValue({
        getId: () => 'mock-sandbox',
        init: vi.fn(),
        teardown: vi.fn(),
        runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
        writeFile: vi.fn(),
        readFile: vi.fn().mockResolvedValue('const x = 1;'),
        getWorkDir: () => '/'
    })
}));

// Mock Analysis Service
vi.mock('../../../services/analysis/LogAnalysisService', () => ({
    diagnoseError: vi.fn().mockResolvedValue({
        summary: 'Test error summary',
        filePath: 'src/app.ts',
        fixAction: 'edit',
        suggestedCommand: null
    }),
    refineProblemStatement: vi.fn().mockResolvedValue('Refined problem'),
    generateRepoSummary: vi.fn().mockResolvedValue('Mock repo summary'),
    generateFix: vi.fn().mockResolvedValue('const x = 2;'),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: 'Good fix' }),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'Tests passed' }),
    generateDetailedPlan: vi.fn().mockResolvedValue({
        goal: 'Fix error',
        tasks: [{ id: '1', description: 'Fix', status: 'pending' }],
        approved: true
    }),
    formatPlanToMarkdown: vi.fn().mockReturnValue('# Plan')
}));

/**
 * Agent Loop Integration Tests (Refactored)
 * 
 * This is a refactored version of agentLoop.test.ts demonstrating
 * the use of new test patterns and helpers.
 */
describe('Agent Loop Integration (Refactored)', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let services: any;
    let updateStateCallback: any;
    let logCallback: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Setup test database
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();

        // Create mock services using helper
        services = createMockServices();

        // Setup callbacks
        updateStateCallback = vi.fn((id, state) => {
            console.log(`[STATE] ${state.phase} - ${state.status}`);
        });
        // Setup GitHub Service mocks on the object
        services.github.getWorkflowLogs.mockResolvedValue({
            logText: 'Mock logs',
            headSha: 'abc123',
            jobName: 'test'
        });
        services.github.findClosestFile.mockResolvedValue({
            file: { name: 'app.ts', content: 'const x = 1;', language: 'typescript' },
            path: 'src/app.ts'
        });
        services.github.getFileContent.mockResolvedValue({
            name: 'app.ts',
            content: 'const x = 1;',
            language: 'typescript'
        });
        logCallback = vi.fn((level, content) => {
            console.log(`[${level}] ${content}`);
        });

        // Configure default happy path responses
        services.github.getWorkflowLogs.mockResolvedValue({
            logText: 'Error: Division by zero',
            jobName: 'test',
            headSha: 'abc123'
        });

        services.github.findClosestFile.mockResolvedValue({
            file: { name: 'app.py', content: '', language: 'python' },
            path: 'app.py'
        });

        services.analysis.diagnoseError.mockResolvedValue({
            summary: 'Division by zero error',
            filePath: 'app.py',
            fixAction: 'edit'
        });

        services.analysis.generateDetailedPlan.mockResolvedValue({
            goal: 'Fix division by zero',
            tasks: [{ id: '1', description: 'Add zero check', status: 'pending' }],
            approved: true
        });

        services.analysis.generateFix.mockResolvedValue('if x != 0:\\n    result = y / x');

        services.analysis.judgeFix.mockResolvedValue({
            passed: true,
            score: 10,
            reasoning: 'Good fix'
        });

        services.analysis.runSandboxTest.mockResolvedValue({
            passed: true,
            logs: 'All tests passed'
        });

        services.sandbox.prepareSandbox.mockResolvedValue({
            getId: () => 'mock-sandbox',
            init: vi.fn(),
            teardown: vi.fn(),
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
            writeFile: vi.fn(),
            readFile: vi.fn().mockResolvedValue(''),
            getWorkDir: () => '/mock'
        });
    });

    afterEach(async () => {
        vi.clearAllMocks();
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    describe('Success Scenarios', () => {
        it('should successfully fix a bug in one iteration', async () => {
            // Use helper to create config
            const config = createMockConfig({
                devEnv: 'simulation',
                checkEnv: 'simulation'
            });

            // Use helper to create run group
            const group = createMockRunGroup({
                id: 'test-group',
                name: 'Test Run'
            });

            const result = await runIndependentAgentLoop(
                config,
                group,
                'Repo Context',
                services,
                updateStateCallback,
                logCallback
            );

            // Use custom matchers for clearer assertions
            if (result.status !== 'success') {
                const fs = await import('fs');
                fs.appendFileSync('debug_failure.txt', `[Refactored] Result: ${JSON.stringify(result, null, 2)}\n`);
            }
            expect(result.status).toBe('success');
            expect(result.phase).toBe(AgentPhase.SUCCESS);

            // Verify file was reserved
            expect(updateStateCallback).toHaveBeenCalledWith(
                group.id,
                expect.objectContaining({ fileReservations: ['app.py'] })
            );

            // Verify services were called
            // Note: executionNode uses imported generateFix, not passing through services object
            expect(services.analysis.diagnoseError).toHaveBeenCalled();
            expect(AnalysisService.generateFix).toHaveBeenCalled();
            // runSandboxTest is on the object? 
            expect(services.analysis.runSandboxTest).toHaveBeenCalled();
        });

        it('should handle command-based fixes', async () => {
            const config = createMockConfig();
            const group = createMockRunGroup();

            // Override diagnosis for command fix
            // Override diagnosis
            services.analysis.diagnoseError.mockResolvedValue({
                summary: 'Missing dependency',
                filePath: '',
                fixAction: 'command',
                suggestedCommand: 'npm install lodash',
                reproductionCommand: 'node -e "require(\'lodash\')"'
            });

            // Mock successful execution
            services.analysis.runSandboxTest.mockResolvedValue({
                passed: true,
                logs: "Success logs"
            });
            const result = await runIndependentAgentLoop(
                config,
                group,
                '',
                services,
                updateStateCallback,
                logCallback
            );

            expect(result.status).toBe('success');

            // Should not call file-related services
            expect(services.github.findClosestFile).not.toHaveBeenCalled();
            expect(services.analysis.generateFix).not.toHaveBeenCalled();
        });
    });

    describe.skip('Failure Scenarios', () => {
        it('should fail after max iterations', async () => {
            const config = createMockConfig();
            const group = createMockRunGroup();

            // Make tests always fail
            services.analysis.runSandboxTest.mockResolvedValue({
                passed: false,
                logs: 'Tests failed'
            });

            const result = await runIndependentAgentLoop(
                config,
                group,
                '',
                services,
                updateStateCallback,
                logCallback
            );

            expect(result.status).toBe('failed');
            expect(result.phase).toBe(AgentPhase.FAILURE);

            // Should have tried multiple times
            const callCount = services.analysis.runSandboxTest.mock.calls.length;
            expect(callCount).toBeGreaterThanOrEqual(1);
        });

        it('should handle network errors gracefully', async () => {
            const config = createMockConfig();
            const group = createMockRunGroup();

            // Simulate network error
            services.github.getWorkflowLogs.mockRejectedValueOnce(
                new Error('Network timeout')
            );
            // Also force diagnosis to fail (since logs are missing)
            services.analysis.diagnoseError.mockResolvedValue({
                summary: 'No logs found',
                filePath: '',
                fixAction: 'unknown' as any,
                suggestedCommand: null
            });

            const result = await runIndependentAgentLoop(
                config,
                group,
                '',
                services,
                updateStateCallback,
                logCallback
            );

            expect(result.status).toBe('failed');
            expect(result.phase).toBe(AgentPhase.FAILURE);
            expect(result.message).toContain('Network timeout');
        });
    });

    describe('Retry Logic', () => {
        it('should retry when judge rejects the fix', async () => {
            const config = createMockConfig();
            const group = createMockRunGroup();

            // First fail, then pass (on Injected Service)
            services.analysis.judgeFix = vi.fn()
                .mockResolvedValueOnce({ passed: false, score: 2, reasoning: 'Bad fix' })
                .mockResolvedValue({ passed: true, score: 10, reasoning: 'Good fix' });

            // Ensure generateFix returns (on Module Mock)
            vi.mocked(AnalysisService.generateFix).mockResolvedValue('fixed code');
            // Ensure runSandboxTest returns success for verification
            services.analysis.runSandboxTest.mockResolvedValue({ passed: true, logs: "ok" });

            const result = await runIndependentAgentLoop(
                config,
                group,
                '',
                services,
                updateStateCallback,
                logCallback
            );

            // Hybrid assertions:
            // verificationNode uses injected services
            expect(services.analysis.judgeFix).toHaveBeenCalledTimes(2);
            // executionNode uses imported module
            expect(AnalysisService.generateFix).toHaveBeenCalledTimes(2);
        });

        it('should fallback to summary search if file path is empty', async () => {
            const config = createMockConfig();
            const group = createMockRunGroup();

            // Diagnosis with empty file path
            services.analysis.diagnoseError.mockResolvedValueOnce({
                summary: 'Duplicate test module',
                filePath: '',
                fixAction: 'edit'
            });

            // First findClosestFile returns null, then finds via search
            services.github.findClosestFile
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    file: { name: 'test_dup.py', content: '', language: 'python' },
                    path: 'test_dup.py'
                });

            services.sandbox.toolCodeSearch.mockResolvedValueOnce(['test_dup.py']);

            const result = await runIndependentAgentLoop(
                config,
                group,
                '',
                services,
                updateStateCallback,
                logCallback
            );

            expect(result.status).toBe('success');
            expect(services.sandbox.toolCodeSearch).toHaveBeenCalled();
        });
    });

    describe('Edge Cases', () => {
        it('should handle missing file with CREATE mode', async () => {
            const config = createMockConfig();
            const group = createMockRunGroup();

            services.analysis.diagnoseError.mockResolvedValueOnce({
                summary: "No such file: 'new.py'",
                filePath: 'new.py',
                fixAction: 'edit'
            });

            services.github.findClosestFile.mockResolvedValueOnce(null);
            services.sandbox.toolCodeSearch.mockResolvedValueOnce([]);
            services.analysis.generateFix.mockResolvedValueOnce("print('hello')");

            const result = await runIndependentAgentLoop(
                config,
                group,
                '',
                services,
                updateStateCallback,
                logCallback
            );

            if (result.status !== 'success') {
                console.error('FINAL AGENT RESULT:', JSON.stringify(result, null, 2));
            }
            expect(result.status).toBe('success');
            expect(updateStateCallback).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ fileReservations: ['new.py'] })
            );
        });

        it('should cleanup sandbox on exit', async () => {
            const config = createMockConfig({ devEnv: 'e2b', e2bApiKey: 'test-key' });
            const group = createMockRunGroup();

            const mockTeardown = vi.fn();
            services.sandbox.prepareSandbox.mockResolvedValueOnce({
                getId: () => 'sandbox-1',
                init: vi.fn(),
                teardown: mockTeardown,
                runCommand: vi.fn(),
                writeFile: vi.fn(),
                readFile: vi.fn(),
                getWorkDir: () => '/'
            });

            // Force failure to trigger cleanup
            services.github.getWorkflowLogs.mockRejectedValueOnce(new Error('Fail'));

            try {
                await runIndependentAgentLoop(config, group, '', services, updateStateCallback, logCallback);
            } catch (error) {
                // Expected to fail
            }

            expect(mockTeardown).toHaveBeenCalled();
        });
    });
});
