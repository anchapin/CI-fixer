import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AppConfig, RunGroup, AgentPhase } from '../../types';

// --- MOCKS ---

// Mock Services
vi.mock('../../services', () => ({
    __esModule: true,
    default: {},
    getWorkflowLogs: vi.fn(),
    toolScanDependencies: vi.fn(),
    diagnoseError: vi.fn(),
    findClosestFile: vi.fn(),
    toolCodeSearch: vi.fn(),
    generateDetailedPlan: vi.fn(),
    toolWebSearch: vi.fn(),
    generateFix: vi.fn(),
    toolLintCheck: vi.fn(),
    judgeFix: vi.fn(),
    runSandboxTest: vi.fn(),
    generateRepoSummary: vi.fn(),
    prepareSandbox: vi.fn()
}));

vi.mock('../../services/context-compiler', () => ({
    getCachedRepoContext: vi.fn((config, sha, gene) => Promise.resolve("mock context"))
}));

// Mock Validation
vi.mock('../../validation', () => ({
    validateFileExists: vi.fn(() => Promise.resolve(true)),
    validateCommand: vi.fn(() => ({ valid: true })),
    analyzeRepository: vi.fn(() => Promise.resolve({})),
    formatProfileSummary: vi.fn(() => "Profile Summary")
}));

// Mock Error Classification
vi.mock('../../errorClassification', () => ({
    classifyError: vi.fn(() => ({ category: 'syntax', confidence: 0.9 })),
    classifyErrorWithHistory: vi.fn(() => ({ category: 'syntax', confidence: 0.9, affectedFiles: [] })),
    formatErrorSummary: vi.fn(),
    getErrorPriority: vi.fn(() => 10),
    isCascadingError: vi.fn(() => false)
}));

// Mock DB
vi.mock('../../db/client', () => ({
    db: {
        errorFact: {
            findFirst: vi.fn(() => Promise.resolve(null)),
            create: vi.fn(() => Promise.resolve({}))
        },
        fileModification: {
            create: vi.fn(() => Promise.resolve({}))
        }
    }
}));

// Mock Metrics
vi.mock('../../services/metrics', () => ({
    recordFixAttempt: vi.fn(),
    recordAgentMetrics: vi.fn()
}));

// Mock Knowledge Base & Actions
vi.mock('../../services/knowledge-base', () => ({
    extractFixPattern: vi.fn(),
    findSimilarFixes: vi.fn(() => Promise.resolve([]))
}));
vi.mock('../../services/action-library', () => ({
    getSuggestedActions: vi.fn(() => Promise.resolve([]))
}));

// Mock Sandbox
vi.mock('../../sandbox', async (importOriginal) => {
    const actual = await importOriginal();

    // Define Mock Class INSIDE factory to avoid hoisting issues
    class MockSimulationSandbox {
        init = vi.fn();
        teardown = vi.fn();
        getId = () => 'sim-mock';
        runCommand = vi.fn(() => Promise.resolve({ stdout: '', exitCode: 0 }));
        writeFile = vi.fn();
    }

    return {
        ...actual as any,
        DockerSandbox: vi.fn(),
        E2BSandbox: vi.fn(),
        SimulationSandbox: MockSimulationSandbox
    };
});


import * as services from '../../services';
import { SimulationSandbox } from '../../sandbox';

describe('Agent Flow Integration (Mocked)', () => {
    const mockUpdateState = vi.fn();
    const mockLog = vi.fn();

    const config: AppConfig = {
        githubToken: 'test-token',
        repoUrl: 'owner/repo',
        llmProvider: 'openai',
        devEnv: 'simulation'
    } as any;

    const group: RunGroup = {
        id: 'run-1',
        name: 'Test Run',
        runIds: [123],
        mainRun: { head_sha: 'sha123' },
        status: 'pending',
        created_at: new Date()
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Default Mock Behaviors for Happy Path
        (services.prepareSandbox as any).mockResolvedValue(new SimulationSandbox());
        (services.getWorkflowLogs as any).mockResolvedValue({ logText: 'Error log...', headSha: 'sha123' });
        (services.diagnoseError as any).mockResolvedValue({
            summary: 'Fix me',
            filePath: 'src/file.ts',
            fixAction: 'edit'
        });
        (services.findClosestFile as any).mockResolvedValue({
            path: 'src/file.ts',
            file: { name: 'file.ts', content: 'broken code', language: 'typescript' }
        });
        (services.generateFix as any).mockResolvedValue('fixed code');
        (services.toolLintCheck as any).mockResolvedValue({ valid: true });
        (services.judgeFix as any).mockResolvedValue({ passed: true, score: 10, reasoning: 'LGTM' });

        // Critical: Verification Success
        (services.runSandboxTest as any).mockResolvedValue({ passed: true, logs: 'All tests passed' });
    });

    it('should complete a successful repair cycle', async () => {
        const result = await runIndependentAgentLoop(config, group, 'ctx', mockUpdateState, mockLog);

        expect(result.status).toBe('success');
        expect(result.phase).toBe(AgentPhase.SUCCESS);

        expect(services.getWorkflowLogs).toHaveBeenCalled();
        expect(services.diagnoseError).toHaveBeenCalled();
        expect(services.generateFix).toHaveBeenCalled();
        expect(services.judgeFix).toHaveBeenCalled();
        expect(services.runSandboxTest).toHaveBeenCalled();

        const metrics = await import('../../services/metrics');
        expect(metrics.recordAgentMetrics).toHaveBeenCalledWith(group.id, 'success', expect.any(Number), expect.any(Number), expect.any(String));
    });

    it('should retry if validation fails', async () => {
        (services.runSandboxTest as any)
            .mockResolvedValueOnce({ passed: false, logs: 'Test Failed' })
            .mockResolvedValueOnce({ passed: true, logs: 'Tests Passed' });

        const result = await runIndependentAgentLoop(config, group, 'ctx', mockUpdateState, mockLog);

        expect(result.status).toBe('success');
        expect(services.diagnoseError).toHaveBeenCalledTimes(2);
    });

    it('should fail if max iterations reached', async () => {
        (services.runSandboxTest as any).mockResolvedValue({ passed: false, logs: 'Still broken' });

        const result = await runIndependentAgentLoop(config, group, 'ctx', mockUpdateState, mockLog);

        expect(result.status).toBe('failed');
        expect(result.phase).toBe(AgentPhase.FAILURE);
        expect(services.diagnoseError).toHaveBeenCalledTimes(5);
    });
});
