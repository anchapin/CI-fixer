import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { runWorkerTask } from '../../agent/worker.js';
import { AppConfig, RunGroup, AgentPhase } from '../../types.js';
import { ServiceContainer } from '../../services/container.js';
import { SandboxEnvironment } from '../../sandbox.js';
import * as fs from 'fs/promises';

// Mocks
vi.mock('../../db/client.js', () => ({
    db: {
        errorFact: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'mock-fact-id' }),
            update: vi.fn(),
        },
        fileModification: {
            create: vi.fn(),
        },
        actionTemplate: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
        }
    },
}));

vi.mock('../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue('No issues'),
    toolCodeSearch: vi.fn().mockResolvedValue(['src/main.ts']),
    toolWebSearch: vi.fn().mockResolvedValue('Search results'),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    prepareSandbox: vi.fn(),
}));

vi.mock('../../services/github/GitHubService.js', () => ({
    getWorkflowLogs: vi.fn(),
    findClosestFile: vi.fn(),
}));

vi.mock('../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn(),
    generateDetailedPlan: vi.fn(),
    generateFix: vi.fn(),
    judgeFix: vi.fn(),
    generateRepoSummary: vi.fn(),
    runSandboxTest: vi.fn(),
}));

vi.mock('../../validation.js', () => ({
    validateFileExists: vi.fn(),
    validateCommand: vi.fn(),
}));

vi.mock('../../errorClassification.js', () => ({
    classifyError: vi.fn(),
    classifyErrorWithHistory: vi.fn(),
    formatErrorSummary: vi.fn(),
    getErrorPriority: vi.fn().mockReturnValue(1),
    isCascadingError: vi.fn().mockReturnValue(false),
}));

vi.mock('../../services/reproduction-inference.js', () => {
    return {
        ReproductionInferenceService: vi.fn().mockImplementation(function() {
            return {
                inferCommand: vi.fn().mockResolvedValue({
                    command: 'npm test inferred',
                    strategy: 'safe_scan',
                    confidence: 0.5,
                    reasoning: 'Found tests directory'
                })
            };
        })
    };
});

// Import mocked modules
import { getWorkflowLogs } from '../../services/github/GitHubService.js';
import { diagnoseError, runSandboxTest } from '../../services/analysis/LogAnalysisService.js';
import { validateCommand } from '../../validation.js';
import { ReproductionInferenceService } from '../../services/reproduction-inference.js';

describe('Reproduction Inference Integration', () => {
    let mockConfig: AppConfig;
    let mockGroup: RunGroup;
    let mockSandbox: SandboxEnvironment;
    let mockServices: ServiceContainer;
    let updateStateCallback: any;
    let logCallback: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        mockConfig = {
            githubToken: 'test-token',
            repoUrl: 'owner/repo',
            devEnv: 'simulation',
            checkEnv: 'simulation'
        };

        mockGroup = {
            id: 'group-1',
            name: 'Test Group',
            runIds: [123],
            mainRun: { head_sha: 'sha123' } as any,
        };

        mockSandbox = {
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
            writeFile: vi.fn().mockResolvedValue(undefined),
            getLocalPath: vi.fn().mockReturnValue('/mock/repo'),
        } as unknown as SandboxEnvironment;

        mockServices = {} as ServiceContainer;
        updateStateCallback = vi.fn();
        logCallback = vi.fn();

        (getWorkflowLogs as Mock).mockResolvedValue({ logText: 'Error: Something went wrong', headSha: 'sha123' });
        (validateCommand as Mock).mockImplementation((cmd) => ({ valid: true, suggestion: cmd }));
        (runSandboxTest as Mock).mockResolvedValue({ passed: true, logs: 'Tests passed' });
        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Fix NullPointerException',
            filePath: 'src/main.ts',
            fixAction: 'edit',
            reproductionCommand: undefined
        });
        const { generateRepoSummary } = await import('../../services/analysis/LogAnalysisService.js');
        (generateRepoSummary as Mock).mockResolvedValue('Repo Summary Content');
        const { classifyErrorWithHistory } = await import('../../errorClassification.js');
        (classifyErrorWithHistory as Mock).mockResolvedValue({
            category: 'logic',
            errorMessage: 'Something went wrong',
            confidence: 0.9,
            affectedFiles: ['src/main.ts'],
            historicalMatches: [],
        });
    });

    it('should infer reproduction command if diagnoseError does not provide one', async () => {
        // Mock diagnoseError to NOT provide a reproductionCommand
        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Fix NullPointerException',
            filePath: 'src/main.ts',
            fixAction: 'edit',
            reproductionCommand: undefined // MISSING
        });

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

        // Check if inference service was used
        expect(ReproductionInferenceService).toHaveBeenCalled();
        const instance = vi.mocked(ReproductionInferenceService).mock.results[0].value;
        expect(instance.inferCommand).toHaveBeenCalledWith(expect.any(String), expect.any(Object), mockSandbox);
        
        // Check if the inferred command was used in logs
        expect(logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Inferred command: npm test inferred'), 'group-1', 'Test Group');
        
        // Check if the inferred command was executed
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm test inferred');
    });
});
