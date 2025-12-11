import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushMultipleFilesToGitHub } from '../../services';
import { AppConfig } from '../../types';

describe('GitHub Write Integration', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockConfig: AppConfig = {
        githubToken: 'gh_token',
        repoUrl: 'owner/repo',
        selectedRuns: [],
        devEnv: 'simulation',
        checkEnv: 'simulation'
    };

    beforeEach(() => {
        fetchSpy.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should push multiple files using Git Database API sequence', async () => {
        // sequence: ref -> commit(base) -> tree -> commit(new) -> ref(update)

        // 1. Get Ref
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ object: { sha: 'latest-commit-sha' } })
        } as Response);

        // 2. Get Commit (Base Tree)
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ tree: { sha: 'base-tree-sha' } })
        } as Response);

        // 3. Create Tree
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ sha: 'new-tree-sha' })
        } as Response);

        // 4. Create Commit
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ sha: 'new-commit-sha', html_url: 'http://github.com/pr' })
        } as Response);

        // 5. Update Ref
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({})
        } as Response);

        const url = await pushMultipleFilesToGitHub(
            mockConfig,
            [{ path: 'file.txt', content: 'content' }],
            'feature-branch'
        );

        expect(url).toBe('http://github.com/pr');
        expect(fetchSpy).toHaveBeenCalledTimes(5);

        // Verify correct API endpoints
        expect(fetchSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('/git/ref/heads/feature-branch'), expect.any(Object));
        expect(fetchSpy).toHaveBeenNthCalledWith(5, expect.stringContaining('/git/refs/heads/feature-branch'), expect.objectContaining({ method: 'PATCH' }));
    });

    it('should throw error if get ref fails', async () => {
        fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
        await expect(pushMultipleFilesToGitHub(mockConfig, [], 'missing-branch'))
            .rejects.toThrow('Failed to get ref');
    });
});
