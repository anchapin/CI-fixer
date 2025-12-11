import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolWebSearch } from '../../services';
import { AppConfig } from '../../types';

describe('Tavily Search Integration', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockConfig: AppConfig = {
        githubToken: 'token',
        repoUrl: 'owner/repo',
        selectedRuns: [],
        devEnv: 'simulation',
        checkEnv: 'simulation',
        tavilyApiKey: 'tvly-key',
        llmProvider: 'zai'
    };

    beforeEach(() => {
        fetchSpy.mockReset();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should use Tavily API if apiKey is present', async () => {
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                answer: 'Tavily Answer',
                results: [{ title: 'Source 1', url: 'http://example.com' }]
            })
        } as Response);

        const res = await toolWebSearch(mockConfig, 'query');

        expect(res).toContain('Tavily Answer');
        expect(fetchSpy).toHaveBeenCalledWith('https://api.tavily.com/search', expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('tvly-key')
        }));
    });

    it('should fallback to Google Search (via unifiedGenerate) if Tavily fails', async () => {
        // Tavily fails
        fetchSpy.mockRejectedValueOnce(new Error('Network Error'));

        // Mock unifiedGenerate response (which calls fetch to LLM provider)
        // We need to mock the response for the LLM call
        fetchSpy.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'LLM Search Result' } }] })
        } as Response);

        const res = await toolWebSearch(mockConfig, 'query');
        expect(res).toBe('LLM Search Result');
    });
});
