
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPRFailedRuns, getFileContent, getWorkflowLogs } from '../../services';

// Mock fetch globally
globalThis.fetch = vi.fn();

describe('GitHub API Helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getPRFailedRuns', () => {
        it('should fetch and filter failed runs', async () => {
            // Mock PR response
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ head: { sha: 'head-sha' } })
            } as Response);

            // Mock Runs response
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    workflow_runs: [
                        { id: 1, name: 'Fail CI', conclusion: 'failure', head_sha: 'head-sha' },
                        { id: 2, name: 'Pass CI', conclusion: 'success', head_sha: 'head-sha' },
                        { id: 3, name: 'Excluded CI', conclusion: 'failure', head_sha: 'head-sha' }
                    ]
                })
            } as Response);

            const runs = await getPRFailedRuns('token', 'owner', 'repo', '123', ['Excluded']);

            expect(runs).toHaveLength(1);
            expect(runs[0].id).toBe(1);
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        it('should throw error on 401', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                json: async () => ({ message: 'Bad creds' })
            } as Response);

            await expect(getPRFailedRuns('token', 'owner', 'repo', '123'))
                .rejects.toThrow('GitHub Authentication Failed');
        });

        it('should fallback to constructed path if API path is missing', async () => {
             vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ head: { sha: 'sha' } })
            } as Response);
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    workflow_runs: [{ id: 1, name: 'Test', conclusion: 'failure', path: null }]
                })
            } as Response);

            const runs = await getPRFailedRuns('token', 'o', 'r', '1');
            expect(runs[0].path).toBe('.github/workflows/Test.yml');
        });
    });

    describe('getFileContent', () => {
        const config = { githubToken: 'token', repoUrl: 'owner/repo' } as any;

        it('should fetch and decode base64 content', async () => {
            const content = "hello world";
            const base64 = btoa(content);

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    name: 'test.txt',
                    content: base64,
                    sha: 'sha'
                })
            } as Response);

            const result = await getFileContent(config, 'path/to/test.txt');
            expect(result.content).toBe(content);
            expect(result.language).toBe('txt');
        });

        it('should detect python language extension', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ name: 'script.py', content: '' })
            } as Response);
            const result = await getFileContent(config, 'script.py');
            expect(result.language).toBe('python');
        });

        it('should detect Dockerfile', async () => {
             vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ name: 'Dockerfile.dev', content: '' })
            } as Response);
            const result = await getFileContent(config, 'Dockerfile.dev');
            expect(result.language).toBe('dockerfile');
        });

        it('should throw proper error for directories', async () => {
             vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: async () => ([ { name: 'child' } ]) // Array implies directory
            } as Response);
            
            await expect(getFileContent(config, 'src/'))
                .rejects.toThrow('Path \'src/\' is a directory');
        });

        it('should handle 404', async () => {
            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                json: async () => ({})
            } as Response);
             await expect(getFileContent(config, 'missing.txt'))
                .rejects.toThrow('404');
        });
    });

    describe('getWorkflowLogs', () => {
        it('should retrieve text logs from failed job', async () => {
             // 1. Get Run (head_sha)
             vi.mocked(fetch).mockResolvedValueOnce({
                 ok: true,
                 json: async () => ({ head_sha: 'abc' })
             } as Response);

             // 2. Get Jobs
             vi.mocked(fetch).mockResolvedValueOnce({
                 ok: true,
                 json: async () => ({
                     jobs: [{ id: 99, name: 'build', conclusion: 'failure' }]
                 })
             } as Response);

             // 3. Get Logs
             vi.mocked(fetch).mockResolvedValueOnce({
                 ok: true,
                 text: async () => "Error Log Content"
             } as Response);

             const res = await getWorkflowLogs('o/r', 1, 'token');
             expect(res.logText).toBe('Error Log Content');
             expect(res.jobName).toBe('build');
             expect(res.headSha).toBe('abc');
        });
    });
});
