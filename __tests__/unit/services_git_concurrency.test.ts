import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { pushMultipleFilesToGitHub } from '../../services';
import { AppConfig } from '../../types';

describe('Git Push Concurrency', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const config: AppConfig = {
        githubToken: 'test-token',
        repoUrl: 'owner/repo',
        llmProvider: 'openai',
        llmModel: 'gpt-4',
        llmBaseUrl: '',
        customApiKey: '',
        searchProvider: 'tavily',
        tavilyApiKey: '',
        devEnv: 'simulation',
        checkEnv: 'simulation',
        e2bApiKey: '',
        sandboxTimeoutMinutes: 10,
        logLevel: 'info',
        excludeWorkflowPatterns: [],
        selectedRuns: []
    };

    beforeEach(() => {
        fetchSpy.mockReset();
    });

    afterAll(() => {
        fetchSpy.mockRestore();
    });

    it('should retry on 409 Conflict/Ref Update Failure and succeed', async () => {
        let attempts = 0;

        fetchSpy.mockImplementation(async (url, opts) => {
            const urlStr = url.toString();

            // 1. Get Ref
            if (urlStr.includes('/git/ref/heads/')) {
                return new Response(JSON.stringify({ object: { sha: `sha-old-${attempts}` } }));
            }
            // 2. Get Commit
            if (urlStr.includes('/git/commits/sha-old-')) {
                return new Response(JSON.stringify({ tree: { sha: 'tree-sha' } }));
            }
            // 3. Create Tree
            if (urlStr.includes('/git/trees') && opts?.method === 'POST') {
                return new Response(JSON.stringify({ sha: 'new-tree-sha' }));
            }
            // 4. Create Commit
            if (urlStr.includes('/git/commits') && opts?.method === 'POST') {
                return new Response(JSON.stringify({ sha: 'new-commit-sha', html_url: 'http://url' }));
            }
            // 5. Update Ref
            if (urlStr.includes('/git/refs/heads/') && opts?.method === 'PATCH') {
                attempts++;
                if (attempts === 1) {
                    return new Response("Optimistic lock failure", { status: 409, statusText: "Conflict" });
                }
                return new Response(JSON.stringify({ object: { sha: 'new-commit-sha' } }));
            }

            return new Response("{}", { status: 200 });
        });

        const result = await pushMultipleFilesToGitHub(config, [{ path: 'test.txt', content: 'foo' }], 'main');

        expect(result).toContain('http://url');
        expect(attempts).toBe(2);
    });

    it('should fail after max retries', async () => {
        fetchSpy.mockImplementation(async (url, opts) => {
            const urlStr = url.toString();
            if (urlStr.includes('refs/heads') && opts?.method === 'PATCH') {
                return new Response("Conflict", { status: 409 });
            }
            if (urlStr.includes('ref/heads')) return new Response(JSON.stringify({ object: { sha: 'sha' } }));
            if (urlStr.includes('commits/sha')) return new Response(JSON.stringify({ tree: { sha: 'tree' } }));
            if (urlStr.includes('trees')) return new Response(JSON.stringify({ sha: 'tree' }));
            if (urlStr.includes('commits')) return new Response(JSON.stringify({ sha: 'commit' }));
            return new Response("Bad URL " + url, { status: 404 });
        });

        await expect(pushMultipleFilesToGitHub(config, [{ path: 't', content: 'c' }], 'main'))
            .rejects.toThrow('Push failed after retries');
    }, 40000);
});
