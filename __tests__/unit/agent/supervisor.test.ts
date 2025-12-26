
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { runSupervisorAgent } from '../../../agent/supervisor.js';
import { AppConfig, RunGroup, AgentState, LogLine } from '../../../types.js';
import { ServiceContainer } from '../../../services/container.js';
import { SandboxEnvironment } from '../../../sandbox.js';

// Mocks
vi.mock('../../../services/sandbox/SandboxService.js', () => ({
    prepareSandbox: vi.fn(),
}));

vi.mock('../../../agent/graph/coordinator.js', () => ({
    runGraphAgent: vi.fn(),
}));

vi.mock('../../../validation.js', () => ({
    analyzeRepository: vi.fn(),
    formatProfileSummary: vi.fn().mockReturnValue('Profile Summary'),
}));

import { prepareSandbox } from '../../../services/sandbox/SandboxService.js';
import { runGraphAgent } from '../../../agent/graph/coordinator.js';
import { analyzeRepository } from '../../../validation.js';

describe('runSupervisorAgent', () => {
    let mockConfig: AppConfig;
    let mockGroup: RunGroup;
    let mockServices: ServiceContainer;
    let updateStateCallback: Mock;
    let logCallback: Mock;
    let mockSandbox: SandboxEnvironment;

    beforeEach(() => {
        vi.clearAllMocks();

        mockConfig = {
            githubToken: 'test-token',
            repoUrl: 'owner/repo',
            llmProvider: 'google',
            llmModel: 'gemini-3-pro-preview',
            devEnv: 'e2b',
        };

        mockGroup = {
            id: 'group-1',
            name: 'Test Group',
            runIds: [123],
            mainRun: { head_sha: 'sha123' } as any,
        };

        mockSandbox = {
            getId: vi.fn().mockReturnValue('sandbox-123'),
            teardown: vi.fn().mockResolvedValue(undefined),
        } as unknown as SandboxEnvironment;

        mockServices = {
            sandbox: {
                prepareSandbox: vi.fn().mockResolvedValue(mockSandbox),
            }
        } as unknown as ServiceContainer;

        updateStateCallback = vi.fn();
        logCallback = vi.fn();

        (runGraphAgent as Mock).mockResolvedValue({ status: 'success' } as AgentState);
        (analyzeRepository as Mock).mockResolvedValue({ name: 'test-repo' });
    });

    it('should initialize sandbox, profile repository, and run graph agent', async () => {
        const result = await runSupervisorAgent(
            mockConfig,
            mockGroup,
            'Initial context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(mockServices.sandbox.prepareSandbox).toHaveBeenCalledWith(mockConfig, 'owner/repo', 'sha123', expect.any(Function));
        expect(analyzeRepository).toHaveBeenCalled();
        expect(runGraphAgent).toHaveBeenCalled();
        expect(mockSandbox.teardown).toHaveBeenCalled();
        expect(result.status).toBe('success');
    });

    it('should fallback to simulation if sandbox initialization fails', async () => {
        (mockServices.sandbox.prepareSandbox as Mock).mockRejectedValue(new Error('Sandbox failed'));

        const result = await runSupervisorAgent(
            mockConfig,
            mockGroup,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Sandbox Init Failed'), expect.any(String), expect.any(String));
        expect(mockConfig.devEnv).toBe('simulation');
        expect(runGraphAgent).toHaveBeenCalled();
        expect(result.status).toBe('success');
    });

    it('should handle repository profiling failure gracefully', async () => {
        (analyzeRepository as Mock).mockRejectedValue(new Error('Profiling failed'));

        const result = await runSupervisorAgent(
            mockConfig,
            mockGroup,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('Repository profiling failed'), expect.any(String), expect.any(String));
        expect(runGraphAgent).toHaveBeenCalled();
        expect(result.status).toBe('success');
    });

    it('should teardown sandbox even if graph agent fails', async () => {
        (runGraphAgent as Mock).mockRejectedValue(new Error('Graph failed'));

        await expect(runSupervisorAgent(
            mockConfig,
            mockGroup,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        )).rejects.toThrow('Graph failed');

        expect(mockSandbox.teardown).toHaveBeenCalled();
    });
});
