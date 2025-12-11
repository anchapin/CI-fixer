import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import {
    unifiedGenerate,
    runSandboxTest,
    getAgentChatResponse,
    generateDetailedPlan,
    judgeDetailedPlan,
    testE2BConnection,
    pushMultipleFilesToGitHub
} from '../../services';
import { AppConfig, RunGroup, FileChange } from '../../types';

// Hoist mocks
const mocks = vi.hoisted(() => ({
    generateContent: vi.fn(),
    sandboxRunCode: vi.fn(),
    sandboxKill: vi.fn(),
    sandboxCreate: vi.fn()
}));

// Mock GoogleGenAI
vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: vi.fn(function () {
            return {
                models: {
                    generateContent: mocks.generateContent
                }
            };
        }),
        Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' }
    };
});

// Mock E2B Code Interpreter
vi.mock('@e2b/code-interpreter', () => {
    const MockSandbox = {
        create: mocks.sandboxCreate
    };
    return {
        Sandbox: MockSandbox,
        __esModule: true,
        ...MockSandbox
    };
});

describe('Services Comprehensive Tests', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockConfig: AppConfig = {
        githubToken: 'token',
        repoUrl: 'owner/repo',
        selectedRuns: [],
        devEnv: 'simulation',
        checkEnv: 'simulation'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        fetchSpy.mockReset();
    });

    afterAll(() => {
        fetchSpy.mockRestore();
    });

    describe('unifiedGenerate', () => {
        it('should use fetch for Z.ai provider', async () => {
            const zaiConfig: AppConfig = { ...mockConfig, llmProvider: 'zai', customApiKey: 'id.secret' };
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'ZAI Response' } }] })
            } as Response);

            const res = await unifiedGenerate(zaiConfig, { contents: 'test' });
            expect(res.text).toBe('ZAI Response');
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining('api.z.ai'),
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: expect.stringContaining('Bearer') })
                })
            );
        });

        it('should use fetch for OpenAI provider', async () => {
            const oaConfig: AppConfig = { ...mockConfig, llmProvider: 'openai', customApiKey: 'sk-key' };
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'GPT Response' } }] })
            } as Response);

            const res = await unifiedGenerate(oaConfig, { contents: 'test' });
            expect(res.text).toBe('GPT Response');
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining('api.openai.com'),
                expect.any(Object)
            );
        });

        it('should handle fetch errors', async () => {
            const oaConfig: AppConfig = { ...mockConfig, llmProvider: 'openai' };
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: async () => 'Client Error'
            } as Response);

            await expect(unifiedGenerate(oaConfig, { contents: 'test' }))
                .rejects.toThrow('Provider API Client Error 400');
        });

        it('should retry on Z.ai fetch network/server errors', async () => {
            const zaiConfig: AppConfig = { ...mockConfig, llmProvider: 'zai' };

            // Mock 1: Network Error (simulated by rejecting the promise)
            fetchSpy.mockRejectedValueOnce(new Error('Failed to fetch'));

            // Mock 2: Server Error (500)
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                status: 502,
                text: async () => 'Bad Gateway'
            } as Response);

            // Mock 3: Success
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'Recovered Z.ai' } }] })
            } as Response);

            const res = await unifiedGenerate(zaiConfig, { contents: 'retry me' });
            expect(res.text).toBe('Recovered Z.ai');
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });

        it('should retry on Google GenAI 503 errors', async () => {
            // First call fails with 503
            mocks.generateContent.mockRejectedValueOnce({ status: 503, message: 'Overloaded' });
            // Second call succeeds
            mocks.generateContent.mockResolvedValueOnce({ text: 'Recovered Response' });

            const res = await unifiedGenerate(mockConfig, { contents: 'retry me' });
            expect(res.text).toBe('Recovered Response');
            expect(mocks.generateContent).toHaveBeenCalledTimes(2);
        });
    });

    describe('runSandboxTest', () => {
        it('should run in simulation mode by default', async () => {
            // Mock prompt response
            mocks.generateContent.mockResolvedValueOnce({ text: '{"passed": true, "logs": "Simulated Success"}' });

            const res = await runSandboxTest(
                mockConfig,
                { mainRun: { head_branch: 'main' } } as unknown as RunGroup,
                1,
                true,
                {
                    path: 'f',
                    original: { name: 'f', language: 'text', content: '' },
                    modified: { name: 'f', language: 'text', content: 'c' },
                    status: 'modified'
                } as FileChange,
                'error',
                vi.fn(),
                {}
            );
            expect(res.passed).toBe(true);
            expect(res.logs).toBe('Simulated Success');
        });

        it('should trigger GitHub Action when checkEnv is github_actions', async () => {
            const ghConfig: AppConfig = { ...mockConfig, checkEnv: 'github_actions' };
            const logCallback = vi.fn();

            // 1. Mock "Triggering" (Push)
            // ref
            fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ object: { sha: 'sha' } }) } as Response);
            // commit
            fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ tree: { sha: 'sha' } }) } as Response);
            // tree
            fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha' }) } as Response);
            // commit
            fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha' }) } as Response);
            // update ref
            fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);

            // 2. Mock Polling
            // First poll: queued
            fetchSpy.mockResolvedValueOnce({
                json: async () => ({ workflow_runs: [{ id: 123, status: 'queued' }] })
            } as Response);
            // Second poll: completed success
            fetchSpy.mockResolvedValueOnce({
                json: async () => ({ workflow_runs: [{ id: 123, status: 'completed', conclusion: 'success' }] })
            } as Response);

            const res = await runSandboxTest(
                ghConfig,
                { mainRun: { head_branch: 'fix-branch' } } as unknown as RunGroup,
                1,
                true,
                {
                    path: 'f',
                    original: { name: 'f', language: 'text', content: '' },
                    modified: { name: 'f', language: 'text', content: 'c' },
                    status: 'modified'
                } as FileChange,
                'error',
                logCallback,
                {}
            );

            expect(res.passed).toBe(true);
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Polling'));
        });
    });

    describe('testE2BConnection', () => {
        it('should return success when connection works', async () => {
            const mockSandbox = {
                runCode: mocks.sandboxRunCode,
                kill: mocks.sandboxKill
            };
            mocks.sandboxCreate.mockResolvedValue(mockSandbox);
            mocks.sandboxRunCode.mockResolvedValue({
                logs: { stdout: ['Connection Verified'], stderr: [] },
                error: null
            });

            const res = await testE2BConnection('e2b_valid_key_12345678901234567890');
            expect(res.success).toBe(true);
            expect(mocks.sandboxCreate).toHaveBeenCalled();
            expect(mocks.sandboxKill).toHaveBeenCalled();
        });

        it('should fail if API key is invalid', async () => {
            const res = await testE2BConnection('e2b_short');
            expect(res.success).toBe(false);
            expect(res.message).toContain('too short');
            expect(mocks.sandboxCreate).not.toHaveBeenCalled();
        });

        it('should handle network errors', async () => {
            mocks.sandboxCreate.mockRejectedValue(new Error('Failed to fetch'));
            const res = await testE2BConnection('e2b_valid_key_12345678901234567890');
            expect(res.success).toBe(false);
            expect(res.message).toContain('Network Connection Failed');
        });
    });

    describe('Other Services', () => {
        it('getAgentChatResponse should return text', async () => {
            mocks.generateContent.mockResolvedValue({ text: 'Chat Response' });
            const res = await getAgentChatResponse(mockConfig, 'hello');
            expect(res).toBe('Chat Response');
        });

        it('generateDetailedPlan should return a plan', async () => {
            mocks.generateContent.mockResolvedValue({
                text: '```json\n{"goal": "fix", "tasks": [], "approved": true}\n```'
            });
            const plan = await generateDetailedPlan(mockConfig, 'error', 'file');
            expect(plan.goal).toBe('fix');
        });

        it('judgeDetailedPlan should approve by default', async () => {
            const res = await judgeDetailedPlan(mockConfig, { goal: 'g', tasks: [], approved: false }, 'err');
            expect(res.approved).toBe(true);
        });

        it('pushMultipleFilesToGitHub should return mock URL', async () => {
            // Mock 1: Get latest commit SHA (ref)
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ object: { sha: 'latestCommitSha' } })
            } as Response);

            // Mock 2: Get base tree SHA
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ tree: { sha: 'baseTreeSha' } })
            } as Response);

            // Mock 3: Create NEW tree
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ sha: 'newTreeSha' })
            } as Response);

            // Mock 4: Create commit
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ sha: 'newCommitSha', html_url: 'https://github.com/mock/pr' })
            } as Response);

            // Mock 5: Update ref
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({})
            } as Response);

            const url = await pushMultipleFilesToGitHub(mockConfig, [{ path: 'test.txt', content: 'hello' }], 'sha');
            expect(url).toBe('https://github.com/mock/pr');
            expect(fetchSpy).toHaveBeenCalledTimes(5);
        });
    });

});
