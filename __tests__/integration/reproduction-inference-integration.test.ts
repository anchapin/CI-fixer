import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { runWorkerTask } from '../../agent/worker.js';
import { AppConfig, RunGroup, AgentPhase } from '../../types.js';
import { ServiceContainer } from '../../services/container.js';
import { SandboxEnvironment } from '../../sandbox.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

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

import { ReproductionInferenceService } from '../../services/reproduction-inference.js';

vi.mock('../../services/reproduction-inference.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/reproduction-inference.js')>();
    return {
        ...actual,
        ReproductionInferenceService: vi.fn().mockImplementation(function() {
            return new actual.ReproductionInferenceService();
        })
    };
});

// Import mocked modules
import { getWorkflowLogs } from '../../services/github/GitHubService.js';
import { diagnoseError, runSandboxTest } from '../../services/analysis/LogAnalysisService.js';
import { validateCommand } from '../../validation.js';

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
            selectedRuns: [],
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
        // Mock filesystem for Safe Scan (tests directory)
        vi.mocked(fs.stat).mockImplementation(async (p: any) => {
            if (p.toString().includes('tests')) return { isDirectory: () => true } as any;
            throw new Error('File not found');
        });
        vi.mocked(fs.readdir).mockResolvedValue(['tests'] as any);

        // Mock diagnoseError to NOT provide a reproductionCommand
        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Fix NullPointerException',
            filePath: 'src/main.ts',
            fixAction: 'edit',
            reproductionCommand: undefined
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
        
        // Check if the inferred command was used in logs
        // Note: Safe Scan for 'tests' directory without package.json returns 'ls tests'
        expect(logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Inferred command: ls tests'), 'group-1', 'Test Group');
        
        // Check if the inferred command was executed
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('ls tests');
    });

    it('should prioritize Workflow over other strategies in full pipeline', async () => {
        // Mock everything to return something, but Workflow should win
        const { ReproductionInferenceService } = await import('../../services/reproduction-inference.js');
        const serviceInstance = new ReproductionInferenceService();
        
        // We'll use the REAL service but mock the file system and sandbox
        vi.mocked(ReproductionInferenceService).mockImplementation(function() {
            return serviceInstance;
        });

        // Mock filesystem for workflow
        vi.mocked(fs.stat).mockImplementation(async (p: any) => {
            const pathStr = p.toString().replace(/\\/g, '/');
            if (pathStr.includes('.github/workflows')) return { isDirectory: () => true } as any;
            if (pathStr.includes('ci.yml')) return { isFile: () => true } as any;
            if (pathStr.includes('package.json')) return { isFile: () => true } as any;
            throw new Error('File not found');
        });
        vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
            const pathStr = p.toString().replace(/\\/g, '/');
            if (pathStr.includes('.github/workflows')) return ['ci.yml'] as any;
            return ['package.json', '.github'] as any;
        });
        vi.mocked(fs.readFile).mockResolvedValue(`
jobs:
  test:
    steps:
      - run: npm run test:workflow
`);

        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Error',
            filePath: 'src/main.ts',
            fixAction: 'edit',
            reproductionCommand: undefined
        });

        await runWorkerTask(mockConfig, mockGroup, mockSandbox, undefined, '', mockServices, updateStateCallback, logCallback);

        expect(logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Inferred command: npm run test:workflow'), 'group-1', 'Test Group');
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm run test:workflow');
    });

    it('should fallback to next strategy if first one fails dry-run', async () => {
        const { ReproductionInferenceService } = await import('../../services/reproduction-inference.js');
        const serviceInstance = new ReproductionInferenceService();
        
        vi.mocked(ReproductionInferenceService).mockImplementation(function() {
            return serviceInstance;
        });

        // package.json (Signature) and test.py (Safe Scan)
        vi.mocked(fs.stat).mockImplementation(async (p: any) => {
            const pathStr = p.toString().replace(/\\/g, '/');
            if (pathStr.includes('package.json')) return { isFile: () => true } as any;
            if (pathStr.includes('test.py')) return { isFile: () => true } as any;
            throw new Error('File not found');
        });
        vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
            const pathStr = p.toString().replace(/\\/g, '/');
            if (pathStr.includes('.github/workflows')) throw new Error('Not found');
            return ['package.json', 'test.py'] as any;
        });
        // Ensure no build tools match
        vi.mocked(fs.readFile).mockImplementation(async (p: any) => {
            throw new Error('File not found');
        });

        // First command (npm test) fails dry-run
        // We need to account for all potential runCommand calls
        (mockSandbox.runCommand as Mock).mockImplementation(async (cmd: string) => {
            if (cmd === 'npm test') return { stdout: '', stderr: 'npm: not found', exitCode: 127 };
            return { stdout: '', stderr: '', exitCode: 1 }; // Pass dry-run for others
        });

        (diagnoseError as Mock).mockResolvedValue({
            summary: 'Error',
            filePath: 'src/main.ts',
            fixAction: 'edit',
            reproductionCommand: undefined
        });

        await runWorkerTask(mockConfig, mockGroup, mockSandbox, undefined, '', mockServices, updateStateCallback, logCallback);

        // Should have tried npm test first (and failed dry-run)
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm test');
        // Should have then tried python test.py (from Safe Scan)
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('python test.py');
        expect(logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Inferred command: python test.py'), 'group-1', 'Test Group');
    });
});
