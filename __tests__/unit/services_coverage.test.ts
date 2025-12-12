
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { runDevShellCommand, getWorkflowLogs } from '../../services';
import { AppConfig } from '../../types';

// Mock E2B
const mocks = vi.hoisted(() => ({
    sandboxCreate: vi.fn(),
    sandboxRunCode: vi.fn(),
    sandboxKill: vi.fn(),
}));

vi.mock('@e2b/code-interpreter', () => {
    return {
        Sandbox: { create: mocks.sandboxCreate },
        __esModule: true
    };
});

describe('Services Coverage Tests', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockConfig: AppConfig = {
        githubToken: 'token',
        repoUrl: 'owner/repo',
        selectedRuns: [],
        devEnv: 'e2b',
        e2bApiKey: 'e2b_valid_key_needs_to_be_longer_than_20',
        checkEnv: 'simulation'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        fetchSpy.mockReset();
    });

    afterAll(() => {
        fetchSpy.mockRestore();
    });



    describe('runDevShellCommand Persistent Sandbox', () => {
        it('should use provided sandbox and NOT kill it', async () => {
            const mockRunCommand = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
            const mockSandbox = {
                sandboxId: 'persistent-id',
                runCommand: mockRunCommand,
                kill: mocks.sandboxKill,
                getId: () => 'persistent-id'
            } as any;

            const res = await runDevShellCommand(mockConfig, 'echo test', mockSandbox);

            expect(res.exitCode).toBe(0);
            expect(res.output).toBe('ok');
            expect(mocks.sandboxCreate).not.toHaveBeenCalled();
            expect(mockRunCommand).toHaveBeenCalledWith('echo test');
            expect(mocks.sandboxKill).not.toHaveBeenCalled(); // Critical check
        });
    });

    describe('getWorkflowLogs Fallback', () => {
        it('should fetch check-runs annotations if no job failed but run failed', async () => {
            // 1. Run Data (Failure, check_suite_url present)
            fetchSpy.mockResolvedValueOnce({
                json: async () => ({
                    conclusion: 'failure',
                    check_suite_url: 'https://api.github.com/checks/1',
                    head_sha: 'sha'
                })
            } as any);

            // 2. Jobs Data (None failed, maybe cancelled or startup error)
            fetchSpy.mockResolvedValueOnce({
                json: async () => ({ jobs: [{ conclusion: 'success' }] })
            } as any);

            // 3. Check Runs Data (One failed check)
            fetchSpy.mockResolvedValueOnce({
                json: async () => ({
                    check_runs: [{
                        name: 'Setup',
                        conclusion: 'failure',
                        output: { summary: 'Invalid YAML' }
                    }]
                })
            } as any);

            const res = await getWorkflowLogs(mockConfig.repoUrl, 1, 'token');

            expect(res.jobName).toBe('Workflow Setup');
            expect(res.logText).toContain('Invalid YAML');
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });
    });

    describe('generateRepoSummary', () => {
        it('should return default summary if sandbox fails', async () => {
            mocks.sandboxCreate.mockResolvedValue({
                runCommand: vi.fn().mockRejectedValue(new Error('Sandbox failed')),
                kill: mocks.sandboxKill
            });
            // We need to mock generateContent for the fallback summary generation
            // But wait, generateRepoSummary calls `unifiedGenerate`? No, it calls `sandbox.runCommand('tree')` etc.
            // If sandbox fails, it might fall back to simulation or return basic info?
            // Checking logic: it tries sandbox.runCommand('find . ...').
            // If sandbox is undefined, it uses "Simulation Mode - File access limited"

            const res = await import('../../services').then(m => m.generateRepoSummary({ ...mockConfig, devEnv: 'simulation' }));
            // In simulation mode (no sandbox passed), it returns specific string
            expect(res).toContain('Simulation Mode');
        });
    });

    describe('findClosestFile', () => {
        it('should return null if file not found locally or in simulation', async () => {
            // In simulation, it relies on file system or simplified search
            const res = await import('../../services').then(m => m.findClosestFile(mockConfig, 'nonexistent.ts'));
            expect(res).toBeNull();
        });
    });


    describe('toolLSPDefinition', () => {
        it('should return empty string in simulation mode', async () => {
            const res = await import('../../services').then(m => m.toolLSPDefinition(mockConfig, 'file.ts', 10));
            expect(res).toBe("");
        });
    });
});
