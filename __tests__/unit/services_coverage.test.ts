
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

    describe('runDevShellCommand Error Handling', () => {
        it('should fallback to simulation on Network Error', async () => {
            mocks.sandboxCreate.mockRejectedValue(new Error('Failed to fetch'));
            const res = await runDevShellCommand(mockConfig, 'ls');

            expect(res.exitCode).toBe(0);
            expect(res.output).toContain('[SYSTEM WARNING]');
            expect(res.output).toContain('[SIMULATION]');
        });

        it('should return error on Auth Error (401)', async () => {
            mocks.sandboxCreate.mockRejectedValue(new Error('401 Unauthorized'));
            const res = await runDevShellCommand(mockConfig, 'ls');

            expect(res.exitCode).toBe(1);
            expect(res.output).toContain('[E2B AUTH ERROR]');
        });

        it('should return error on Timeout', async () => {
            mocks.sandboxCreate.mockRejectedValue(new Error('Connection timed out')); // Matches 'timeout' or 'Timeout' logic
            const res = await runDevShellCommand(mockConfig, 'ls');

            expect(res.exitCode).toBe(1);
            expect(res.output).toContain('E2B Exception');
        });
    });

    describe('runDevShellCommand Persistent Sandbox', () => {
        it('should use provided sandbox and NOT kill it', async () => {
            const mockSandbox = {
                sandboxId: 'persistent-id',
                runCode: mocks.sandboxRunCode,
                kill: mocks.sandboxKill
            } as any;

            mocks.sandboxRunCode.mockResolvedValue({ logs: { stdout: ['ok'], stderr: [] }, error: null });

            const res = await runDevShellCommand(mockConfig, 'echo test', mockSandbox);

            expect(res.exitCode).toBe(0);
            expect(res.output).toBe('ok');
            expect(mocks.sandboxCreate).not.toHaveBeenCalled();
            expect(mocks.sandboxRunCode).toHaveBeenCalledWith('echo test', { language: 'bash' });
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
});
