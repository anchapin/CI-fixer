import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWorkerTask } from '../../../agent/worker';

// ALL MOCKS AT THE TOP
vi.mock('../../../db/client.js', () => ({
    db: {
        errorFact: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'fact-1' })
        },
        fileModification: {
            create: vi.fn().mockResolvedValue({})
        }
    }
}));

vi.mock('../../../services/github/GitHubService.js', () => ({
    getWorkflowLogs: vi.fn(),
    findClosestFile: vi.fn(),
    pushMultipleFilesToGitHub: vi.fn().mockResolvedValue('url')
}));

vi.mock('../../../services/context-manager.js', () => ({
    thinLog: vi.fn(t => t),
    formatHistorySummary: vi.fn(t => 'summary'),
    formatPlanToMarkdown: vi.fn(t => 'plan'),
    ContextPriority: { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 }
}));

vi.mock('../../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn().mockResolvedValue({ summary: 'S', fixAction: 'edit', filePath: 'f.ts' }),
    generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'g', tasks: [] }),
    generateFix: vi.fn().mockResolvedValue('fixed code'),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 8, reasoning: 'good' }),
    generateRepoSummary: vi.fn().mockResolvedValue('repo summary'),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'test passed' })
}));

vi.mock('../../../errorClassification.js', () => ({
    classifyErrorWithHistory: vi.fn().mockResolvedValue({ category: 'syntax', confidence: 0.9, affectedFiles: ['f.ts'] }),
    getErrorPriority: vi.fn().mockReturnValue(1),
    isCascadingError: vi.fn().mockReturnValue(false),
    formatErrorSummary: vi.fn().mockReturnValue('summary'),
    isCascadingErrorWithHistory: vi.fn().mockReturnValue(false)
}));

vi.mock('../../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue('dep report'),
    toolCodeSearch: vi.fn().mockResolvedValue([]),
    toolWebSearch: vi.fn().mockResolvedValue('web result'),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    prepareSandbox: vi.fn()
}));

vi.mock('../../../services/reproduction-inference.js', () => ({
    ReproductionInferenceService: class {
        inferCommand = vi.fn().mockResolvedValue({ command: 'npm test', strategy: 'test' })
    }
}));

vi.mock('../../../validation.js', () => ({
    validateFileExists: vi.fn().mockResolvedValue(true),
    validateCommand: vi.fn().mockReturnValue({ valid: true })
}));

vi.mock('../../../services/metrics.js', () => ({
    recordFixAttempt: vi.fn().mockResolvedValue({}),
    recordAgentMetrics: vi.fn().mockResolvedValue({}),
    recordReproductionInference: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../services/dependency-tracker.js', () => ({
    hasBlockingDependencies: vi.fn().mockResolvedValue(false),
    markErrorInProgress: vi.fn().mockResolvedValue({}),
    markErrorResolved: vi.fn().mockResolvedValue({}),
    recordErrorDependency: vi.fn().mockResolvedValue({}),
    getBlockedErrors: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../services/error-clustering.js', () => ({
    clusterError: vi.fn().mockResolvedValue({})
}));

vi.mock('../../../services/knowledge-base.js', () => ({
    extractFixPattern: vi.fn().mockResolvedValue({}),
    findSimilarFixes: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../services/action-library.js', () => ({
    getSuggestedActions: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../services/dependency-analyzer.js', () => ({
    getImmediateDependencies: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../services/sandbox/ProvisioningService.js', () => ({
    ProvisioningService: class {
        ensureRunner = vi.fn().mockResolvedValue(undefined);
    }
}));

import { getWorkflowLogs, findClosestFile } from '../../../services/github/GitHubService.js';
import { diagnoseError, runSandboxTest } from '../../../services/analysis/LogAnalysisService.js';
import { classifyErrorWithHistory, isCascadingError, getErrorPriority } from '../../../errorClassification.js';
import { toolCodeSearch } from '../../../services/sandbox/SandboxService.js';

describe('Worker Agent Enhanced', () => {
    const mockConfig = { githubToken: 'token', repoUrl: 'owner/repo' };
    const mockGroup = { id: 'g1', name: 'Workflow', runIds: [123], mainRun: { head_sha: 'sha' } };
    const mockSandbox = { 
        runCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
        writeFile: vi.fn().mockResolvedValue(undefined),
        getLocalPath: vi.fn().mockReturnValue('.')
    };
    
    const mockProfile = {
        languages: ['typescript'],
        packageManager: 'npm',
        buildSystem: 'vite',
        testFramework: 'vitest',
        availableScripts: { test: 'vitest' },
        directoryStructure: {
            hasBackend: false,
            hasFrontend: true,
            testDirectories: ['__tests__'],
            sourceDirectories: ['src']
        },
        configFiles: ['package.json', 'vitest.config.ts'],
        repositorySize: 100
    };
    
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getWorkflowLogs).mockResolvedValue({ logText: 'error logs', headSha: 'sha' } as any);
    });

    it('should handle log discovery fallbacks when logs are missing', async () => {
        vi.mocked(getWorkflowLogs).mockImplementation(async (repo, runId, token, strategy) => {
            if (strategy === 'standard') return { logText: 'No failed job found', headSha: 'sha' } as any;
            return { logText: 'found logs', headSha: 'sha' } as any;
        });

        await runWorkerTask(mockConfig as any, mockGroup as any, mockSandbox as any, mockProfile as any, '', {} as any, vi.fn(), vi.fn());
        
        expect(getWorkflowLogs).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 'extended');
    });

    it('should limit iterations for low priority errors', async () => {
        vi.mocked(getErrorPriority).mockReturnValue(3); // Low priority
        vi.mocked(runSandboxTest).mockResolvedValue({ passed: false, logs: 'fail' });

        const result = await runWorkerTask(mockConfig as any, mockGroup as any, mockSandbox as any, mockProfile as any, '', {} as any, vi.fn(), vi.fn());
        
        expect(result.iteration).toBeLessThan(5);
    });

    it('should handle target file search fallback using code search', async () => {
        vi.mocked(diagnoseError).mockResolvedValue({ summary: 'Error: no such file f.ts', fixAction: 'edit', filePath: 'missing.ts' } as any);
        vi.mocked(findClosestFile).mockResolvedValueOnce(null).mockResolvedValue({ path: 'found.ts', file: { content: 'c', language: 'ts' } } as any);
        vi.mocked(toolCodeSearch).mockResolvedValue(['found.ts']);

        await runWorkerTask(mockConfig as any, mockGroup as any, mockSandbox as any, mockProfile as any, '', {} as any, vi.fn(), vi.fn());
        
        expect(toolCodeSearch).toHaveBeenCalled();
    });

    it('should handle worker crash gracefully', async () => {
        vi.mocked(getWorkflowLogs).mockRejectedValue(new Error('fatal error'));
        
        const result = await runWorkerTask(mockConfig as any, mockGroup as any, mockSandbox as any, mockProfile as any, '', {} as any, vi.fn(), vi.fn());
        expect(result.status).toBe('failed');
        expect(result.message).toBe('fatal error');
    });
});
