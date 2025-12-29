
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { runWorkerTask } from '../../../agent/worker.js';
import { AgentPhase, AgentState, AppConfig, RunGroup } from '../../../types.js';
import { ServiceContainer } from '../../../services/container.js';
import { SandboxEnvironment } from '../../../sandbox.js';

// Mocks
vi.mock('../../../db/client.js', () => ({
    db: {
        errorFact: {
            findFirst: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'mock-fact-id' }),
            update: vi.fn(),
        },
        fileModification: {
            create: vi.fn(),
        },
    },
}));

vi.mock('../../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue('No issues'),
    toolCodeSearch: vi.fn().mockResolvedValue(['src/main.ts']),
    toolWebSearch: vi.fn().mockResolvedValue('Search results'),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    prepareSandbox: vi.fn(),
}));

vi.mock('../../../services/github/GitHubService.js', () => ({
    getWorkflowLogs: vi.fn(),
    findClosestFile: vi.fn(),
}));

vi.mock('../../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn(),
    generateDetailedPlan: vi.fn(),
    generateFix: vi.fn(),
    judgeFix: vi.fn(),
    generateRepoSummary: vi.fn(),
    runSandboxTest: vi.fn(),
}));

vi.mock('../../../validation.js', () => ({
    validateFileExists: vi.fn(),
    validateCommand: vi.fn(),
}));

vi.mock('../../../errorClassification.js', () => ({
    classifyError: vi.fn(),
    classifyErrorWithHistory: vi.fn(),
    formatErrorSummary: vi.fn(),
    getErrorPriority: vi.fn().mockReturnValue(10),
    isCascadingError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../services/metrics.js', () => ({
    recordFixAttempt: vi.fn(),
    recordAgentMetrics: vi.fn(),
    recordReproductionInference: vi.fn(),
}));

vi.mock('../../../services/knowledge-base.js', () => ({
    extractFixPattern: vi.fn(),
    findSimilarFixes: vi.fn(),
}));

vi.mock('../../../services/action-library.js', () => ({
    getSuggestedActions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/dependency-analyzer.js', () => ({
    getImmediateDependencies: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/context-compiler.js', () => ({
    getCachedRepoContext: vi.fn().mockResolvedValue('Repo Context'),
}));

vi.mock('../../../services/dependency-tracker.js', () => ({
    recordErrorDependency: vi.fn(),
    hasBlockingDependencies: vi.fn().mockResolvedValue(false),
    markErrorInProgress: vi.fn(),
    markErrorResolved: vi.fn(),
    getBlockedErrors: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/notes-manager.js', () => ({
    recordDecision: vi.fn(),
    recordAttempt: vi.fn(),
    formatNotesForPrompt: vi.fn(),
}));

vi.mock('../../../services/error-clustering.js', () => ({
    clusterError: vi.fn(),
}));

// Import mocked modules to setup implementation
import { getWorkflowLogs, findClosestFile } from '../../../services/github/GitHubService.js';
import { diagnoseError, generateDetailedPlan, generateFix, judgeFix, runSandboxTest } from '../../../services/analysis/LogAnalysisService.js';
import { validateFileExists, validateCommand } from '../../../validation.js';
import { classifyErrorWithHistory } from '../../../errorClassification.js';
import { hasBlockingDependencies, getBlockedErrors } from '../../../services/dependency-tracker.js';
import { toolCodeSearch } from '../../../services/sandbox/SandboxService.js';
import { db } from '../../../db/client.js';
import { unifiedGenerate } from '../../../services/llm/LLMService.js';

vi.mock('../../../services/llm/LLMService.js', () => ({
    unifiedGenerate: vi.fn(),
}));

describe('runWorkerTask', () => {
    let mockConfig: AppConfig;
    let mockGroup: RunGroup;
    let mockSandbox: SandboxEnvironment;
    let mockServices: ServiceContainer;
    let updateStateCallback: Mock;
    let logCallback: Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        mockConfig = {
            githubToken: 'test-token',
            repoUrl: 'owner/repo',
            // @ts-expect-error - Testing protected/private method or invalid args
            redisUrl: 'redis://localhost:6379',
            openaiApiKey: 'test-key',
        };

        mockGroup = {
            id: 'group-1',
            name: 'Test Group',
            runIds: [123],
            mainRun: { head_sha: 'sha123' } as any,
            // @ts-expect-error - Testing protected/private method or invalid args
            fileReservations: [],
        };

        mockSandbox = {
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
            writeFile: vi.fn().mockResolvedValue(undefined),
            readFile: vi.fn().mockResolvedValue(''),
            deleteFile: vi.fn().mockResolvedValue(undefined),
        } as unknown as SandboxEnvironment;

        mockServices = {
            fixPattern: {
                analyzePipReportForConflicts: vi.fn().mockReturnValue([]),
                generateRelaxationSuggestion: vi.fn().mockResolvedValue('pydantic>=2.0.0\ncrewai==0.1.0'),
            }
        } as unknown as ServiceContainer;
        updateStateCallback = vi.fn();
        logCallback = vi.fn();

        // Default Mock Implementations
        (getWorkflowLogs as Mock).mockResolvedValue({ logText: 'Error: Something went wrong', jobName: 'test', headSha: 'sha123' });
        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Fix NullPointerException',
            filePath: 'src/main.ts',
            fixAction: 'edit',
        });
        (findClosestFile as Mock).mockImplementation(async (config, filename) => {
            if (filename === 'requirements.txt') return null;
            return {
                path: 'src/main.ts',
                file: { name: 'main.ts', content: 'const a = null;', language: 'typescript' },
            };
        });
        (validateFileExists as Mock).mockResolvedValue(true);
        (generateDetailedPlan as Mock).mockResolvedValue({ steps: ['fix code'] });
        (generateFix as Mock).mockResolvedValue('const a = 1;');
        (judgeFix as Mock).mockResolvedValue({ passed: true, score: 10, reasoning: 'LGTM' });
        (runSandboxTest as Mock).mockResolvedValue({ passed: true, logs: 'Tests passed' });
        (classifyErrorWithHistory as Mock).mockResolvedValue({
            category: 'logic',
            errorMessage: 'Something went wrong',
            confidence: 0.9,
            affectedFiles: ['src/main.ts'],
            historicalMatches: [],
        });
        (hasBlockingDependencies as Mock).mockResolvedValue(false);
    });

    it('should successfully diagnose, fix, and verify an error', async () => {
        const result = await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined, // profile
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('success');
        expect(result.phase).toBe(AgentPhase.SUCCESS);
        expect(getWorkflowLogs).toHaveBeenCalled();
        expect(diagnoseError).toHaveBeenCalled();
        expect(generateFix).toHaveBeenCalled();
        expect(runSandboxTest).toHaveBeenCalled();
        expect(logCallback).toHaveBeenCalledWith('SUCCESS', 'Worker succeeded.', 'group-1', 'Test Group');
    });

    it('should fail if max iterations are reached', async () => {
        // Mock judge rejection to force retry loops
        (judgeFix as Mock).mockResolvedValue({ passed: false, score: 0, reasoning: 'Bad fix' });

        // Also ensure runSandboxTest doesn't mistakenly pass if it gets there (though judge fail usually skips it)
        (runSandboxTest as Mock).mockResolvedValue({ passed: false, logs: 'Failed' });

        const result = await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('failed');
        expect(result.phase).toBe(AgentPhase.FAILURE);
        expect(logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Worker failed after 5 attempts'), 'group-1', 'Test Group');
    });

    it('should retry log retrieval if "No failed job found" is returned', async () => {
        (getWorkflowLogs as Mock)
            .mockResolvedValueOnce({ logText: 'No failed job found', jobName: 'test', headSha: 'sha123' })
            .mockResolvedValueOnce({ logText: 'Error: Real error now', jobName: 'test', headSha: 'sha123' });

        await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(getWorkflowLogs).toHaveBeenCalledTimes(2);
        expect(diagnoseError).toHaveBeenCalled(); // Should proceed after successful retry
    });

    it('should handle command execution fixes', async () => {
        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Run command',
            fixAction: 'command',
            suggestedCommand: 'npm install',
            filePath: '',
        });
        (runSandboxTest as Mock).mockResolvedValue({ passed: true, logs: 'Done' });

        const result = await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('success');
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm install');
    });

    it('should trigger dependency inspector when dependency errors are found', async () => {
        (getWorkflowLogs as Mock).mockResolvedValue({
            logText: "ImportError: No module named 'numpy'",
            jobName: 'test',
            headSha: 'sha123'
        });

        await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        // Tool use phase should be entered
        expect(logCallback).toHaveBeenCalledWith('TOOL', expect.stringContaining('Invoking legacy Dependency Inspector'), 'group-1', 'Test Group');
        // It consumes a tool call, so we check if dependency scan was called
        const { toolScanDependencies } = await import('../../../services/sandbox/SandboxService.js');
        expect(toolScanDependencies).toHaveBeenCalled();
    });

    it('should create a new file if target file is missing and fix action is edit', async () => {
        (diagnoseError as Mock).mockImplementation(async () => ({
            // Must include "create" to bypass safety check
            summary: "Create missing_file.ts",
            filePath: "src/missing_file.ts",
            fixAction: "edit",
        }));
        (validateFileExists as Mock).mockImplementation(async () => false);
        (findClosestFile as Mock).mockImplementation(async () => null);
        (toolCodeSearch as Mock).mockResolvedValue([]); // No results found

        const result = await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('success');
        // Should have attempted to write the new file
        expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('CREATE mode'), 'group-1', 'Test Group');
    });

    it('should skip processing if error is blocked by dependencies', async () => {
        (hasBlockingDependencies as Mock).mockImplementation(async () => true);
        (getBlockedErrors as Mock).mockResolvedValue([{ blockedBy: [{ summary: 'Blocker Error' }] }]);

        await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        // Verification: It should log the warning about blocking dependencies
        // Loose matching for "blocked by" to handle casing differences
        expect(logCallback).toHaveBeenCalledWith('WARN', expect.stringMatching(/blocked by/i), 'group-1', 'Test Group');
    });

    it('should detect and report secondary errors during command execution', async () => {
        // Ensure DB returns an ID for the current error fact
        const { db } = await import('../../../db/client.js');
        (db.errorFact.create as Mock).mockResolvedValue({ id: 'active-fact-id' });

        // Diagnosis says run command
        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Run setup',
            fixAction: 'command',
            suggestedCommand: 'npm install',
            filePath: '',
        });

        // Command sequence:
        // 1. inferCommand -> validateCommand -> runCommand (Success)
        // 2. reproduce -> runCommand (Failure/Reproduced)
        // 3. implement -> runCommand (Failure -> Secondary Issue)
        // 4. (Next iteration) implement -> runCommand (Success)
        (mockSandbox.runCommand as Mock)
            .mockResolvedValueOnce({ stdout: 'Validated', stderr: '', exitCode: 0 }) // 1. Inference
            .mockResolvedValueOnce({ stdout: 'Repro failure', stderr: '', exitCode: 1 }) // 2. Repro
            .mockResolvedValueOnce({ stdout: '', stderr: 'Error: Connection refused', exitCode: 1 }) // 3. Implementation failure
            .mockResolvedValueOnce({ stdout: 'Done', stderr: '', exitCode: 0 }); // 4. Final success

        // Secondary classification mocking
        const { classifyErrorWithHistory } = await import('../../../errorClassification.js');
        (classifyErrorWithHistory as Mock)
            .mockResolvedValue({ // Default
                category: 'logic',
                errorMessage: 'Run setup',
                confidence: 0.9,
                affectedFiles: [],
            })
            .mockResolvedValueOnce({ // Iteration 0 Start
                category: 'logic',
                errorMessage: 'Run setup',
                confidence: 0.9,
                affectedFiles: [],
            })
            .mockResolvedValueOnce({ // Inside command failure (Secondary Discovery)
                category: 'network',
                errorMessage: 'Connection refused',
                confidence: 0.9,
                affectedFiles: [],
            })
            .mockResolvedValueOnce({ // Iteration 1 Start
                category: 'network',
                errorMessage: 'Connection refused',
                confidence: 0.9,
                affectedFiles: [],
            });

        await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        // Should identify secondary issue
        expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Found secondary issue'), 'group-1', 'Test Group');
    });

    it('should retry log retrieval with different strategies if logs are missing', async () => {
        (getWorkflowLogs as any)
            .mockResolvedValueOnce({ logText: 'No failed job found', jobName: 'test', headSha: 'sha1' }) // Iteration 0 (Standard) -> Fail
            .mockResolvedValueOnce({ logText: 'Actual Log Content', jobName: 'test', headSha: 'sha1' }); // Retry success

        (diagnoseError as any).mockResolvedValue({ summary: 'Diag', fixAction: 'edit' });
        (validateFileExists as any).mockResolvedValue(true);
        (validateCommand as any).mockResolvedValue(true);

        const result = await runWorkerTask(mockConfig, mockGroup, mockSandbox, undefined, '', mockServices, updateStateCallback, logCallback);

        expect(getWorkflowLogs).toHaveBeenCalledTimes(2);
        expect(getWorkflowLogs).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(Number), expect.any(String), 'extended');
    });

    it('should fail if logs are never found after retries', async () => {
        // Mock always fail
        (getWorkflowLogs as any).mockResolvedValue({ logText: 'No failed job found', jobName: 'test', headSha: 'sha1' });

        const result = await runWorkerTask(mockConfig, mockGroup, mockSandbox, undefined, '', mockServices, updateStateCallback, logCallback);

        expect(result.status).toBe('failed');
        expect(result.message).toContain('No failed job found');
    });

    it('should handle worker crash gracefully', async () => {
        (getWorkflowLogs as any).mockRejectedValue(new Error('Critical Infrastructure Failure'));

        const result = await runWorkerTask(mockConfig, mockGroup, mockSandbox, undefined, '', mockServices, updateStateCallback, logCallback);

        expect(result.status).toBe('failed');
        expect(result.phase).toBe(AgentPhase.FAILURE);
        expect(result.message).toContain('Critical Infrastructure Failure');
        expect(logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Worker crashed'), 'group-1', 'Test Group');
    });

    it('should use autonomous dependency solver when requirements.txt is found', async () => {
        (getWorkflowLogs as Mock).mockResolvedValue({
            logText: "ContextualVersionConflict: (pydantic 1.10.13, Requirement.parse('pydantic>=2.0.0'), {'crewai'})",
            jobName: 'test',
            headSha: 'sha123'
        });

        // Mock findClosestFile to return requirements.txt
        (findClosestFile as Mock).mockImplementation(async (config, filename) => {
            if (filename === 'requirements.txt') {
                return {
                    path: 'requirements.txt',
                    file: { name: 'requirements.txt', content: 'pydantic==1.10.13\ncrewai==0.1.0', language: 'text' },
                };
            }
            return {
                path: 'src/main.ts',
                file: { name: 'main.ts', content: 'const a = null;', language: 'typescript' },
            };
        });

        // Mock report content
        const mockReport = JSON.stringify({
            install: [{ metadata: { name: 'pydantic', version: '1.10.13', requires_dist: [] } }]
        });
        (mockSandbox.readFile as Mock).mockResolvedValue(mockReport);

        // Mock LLM response for relaxation
        (unifiedGenerate as Mock).mockResolvedValue({
            text: '```\npydantic>=2.0.0\ncrewai==0.1.0\n```',
            metrics: { tokensInput: 100, tokensOutput: 50, cost: 0.01, latency: 500, model: 'test-model' }
        });

        // Mock pip check and install to succeed
        (mockSandbox.runCommand as Mock).mockResolvedValue({ stdout: 'Success', stderr: '', exitCode: 0 });

        // Mock classification to avoid crash
        (classifyErrorWithHistory as Mock).mockResolvedValue({
            category: 'dependency_conflict',
            errorMessage: 'Conflict',
            confidence: 0.9,
            affectedFiles: ['requirements.txt'],
            historicalMatches: [],
        });

        // Mock conflict analysis to return a conflict
        (mockServices.fixPattern.analyzePipReportForConflicts as Mock).mockReturnValue([{
            package: 'pydantic',
            version: '1.10.13',
            conflict: 'Requirement pydantic>=2.0.0'
        }]);

        await runWorkerTask(
            mockConfig,
            mockGroup,
            mockSandbox,
            undefined,
            'Initial Context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Starting autonomous solver'), 'group-1', 'Test Group');
        expect(logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Autonomous dependency solver succeeded'), 'group-1', 'Test Group');
        
        // Should have attempted to resolve
        expect(mockServices.fixPattern.generateRelaxationSuggestion).toHaveBeenCalled();
    });
});
