import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    getPRFailedRuns, 
    getWorkflowLogs, 
    getFileContent, 
    findClosestFile, 
    pushMultipleFilesToGitHub 
} from '../../../../services/github/GitHubService';

describe('GitHubService Enhanced', () => {
    const mockToken = 'token';
    const mockOwner = 'owner';
    const mockRepo = 'repo';

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    describe('getPRFailedRuns', () => {
        it('should handle missing runs', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ head: { sha: 'sha' } })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ workflow_runs: null })
            } as any);

            const result = await getPRFailedRuns(mockToken, mockOwner, mockRepo, '1');
            expect(result).toEqual([]);
        });

        it('should apply exclude patterns', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ head: { sha: 'sha' } })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ workflow_runs: [{ name: 'Exclude Me', conclusion: 'failure' }, { name: 'Keep Me', conclusion: 'failure' }] })
            } as any);

            const result = await getPRFailedRuns(mockToken, mockOwner, mockRepo, '1', ['exclude']);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Keep Me');
        });
    });

    describe('getWorkflowLogs', () => {
        it('should handle timed out runs with no jobs', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'completed', conclusion: 'timed_out', check_suite_url: 'url', head_sha: 'sha' })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ jobs: [] })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ check_runs: [{ name: 'Check', conclusion: 'failure', output: { summary: 'timed out' } }] })
            } as any);

            const result = await getWorkflowLogs('owner/repo', 123, mockToken);
            expect(result.logText).toContain('Check Run \'Check\' failed');
        });

        it('should return empty if no failed job found and run not failed', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'completed', conclusion: 'success', head_sha: 'sha' })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ jobs: [] })
            } as any);

            const result = await getWorkflowLogs('owner/repo', 123, mockToken);
            expect(result.logText).toContain('No failed job found');
        });

        it('should handle failed run with no jobs and no failed check run', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'completed', conclusion: 'failure', check_suite_url: 'url', head_sha: 'sha' })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ jobs: [] })
            } as any).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ check_runs: [] })
            } as any);

            const result = await getWorkflowLogs('owner/repo', 123, mockToken);
            expect(result.logText).toContain('Could not locate specific check run failure');
        });
    });

    describe('getFileContent', () => {
        it('should detect jsx and tsx as javascript', async () => {
            vi.mocked(fetch).mockResolvedValue({
                ok: true,
                json: async () => ({ name: 'file.tsx', content: btoa('content'), sha: 'sha' })
            } as any);

            const result = await getFileContent({ repoUrl: 'o/r', githubToken: 't' } as any, 'file.tsx');
            expect(result.language).toBe('javascript');
        });
    });

    describe('findClosestFile', () => {
        it('should return null if sandbox readFile returns null', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as any);
            const mockSandbox = {
                readFile: vi.fn().mockResolvedValue(null)
            };

            const result = await findClosestFile({ repoUrl: 'o/r', githubToken: 't' } as any, 'f.py', mockSandbox);
            expect(result).toBeNull();
        });
    });

    describe('pushMultipleFilesToGitHub', () => {
        it('should handle non-404 ref errors', async () => {
            vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Error' } as any);
            
            vi.useFakeTimers();
            const promise = pushMultipleFilesToGitHub({ repoUrl: 'o/r', githubToken: 't' } as any, [], 'main');
            const rejectionExpectation = expect(promise).rejects.toThrow('Push failed');
            
            // Advance timers for all 5 retries
            for (let i = 0; i < 5; i++) {
                await vi.runAllTimersAsync();
            }
            
            await rejectionExpectation;
            vi.useRealTimers();
        });

        it('should handle noRetry errors (401)', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' } as any);
            
            // Should fail quickly without 5 retries
            const startTime = Date.now();
            await expect(pushMultipleFilesToGitHub({ repoUrl: 'o/r', githubToken: 't' } as any, [], 'main')).rejects.toThrow('Push failed');
            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(2000); // Definitely less than 5 retries with backoff
        });
    });
});
