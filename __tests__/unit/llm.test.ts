
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { unifiedGenerate, toolLintCheck } from '../../services';
import { AppConfig } from '../../types';

// Mock dependencies
const mocks = vi.hoisted(() => ({
    generateContent: vi.fn()
}));

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn(function () { // Use standard function to allow 'new'
        return {
            models: { generateContent: mocks.generateContent }
        };
    }),
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN' }
}));

describe('LLM Provider & Tools', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    beforeEach(() => {
        vi.clearAllMocks();
        fetchSpy.mockReset();
    });

    afterAll(() => {
        fetchSpy.mockRestore();
    });

    describe('unifiedGenerate', () => {
        it('should call Gemini when provider is gemini', async () => {
            const config: AppConfig = { llmProvider: 'gemini', githubToken: '', repoUrl: '', selectedRuns: [], devEnv: 'simulation', checkEnv: 'simulation' };
            mocks.generateContent.mockResolvedValue({ text: 'gemini response' });

            const res = await unifiedGenerate(config, { contents: 'prompt' });
            expect(res.text).toBe('gemini response');
            expect(mocks.generateContent).toHaveBeenCalled();
        });

        it('should call Z.AI (via fetch) when provider is zai', async () => {
            const config: AppConfig = { llmProvider: 'zai', customApiKey: 'key', githubToken: '', repoUrl: '', selectedRuns: [], devEnv: 'simulation', checkEnv: 'simulation', llmModel: 'GLM-4.7' };

            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'zai response' } }] })
            } as Response);

            const res = await unifiedGenerate(config, { contents: 'prompt' });
            expect(res.text).toBe('zai response');

            // Check that fetch was called with the Z.AI model
            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body as string);
            expect(body.model).toBe('GLM-4.7');
        });

        it('should ignore Gemini model constant and use configured model if provider is Z.AI', async () => {
            // Case: Internal function passes 'gemini-2.5-flash' but user selected Z.AI / GLM-4.7
            const config: AppConfig = {
                llmProvider: 'zai',
                customApiKey: 'key',
                llmModel: 'GLM-4.7',
                githubToken: '',
                repoUrl: '',
                selectedRuns: [],
                devEnv: 'simulation',
                checkEnv: 'simulation'
            };

            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: 'ok' } }] })
            } as Response);

            // Pass Gemini model as `model` param
            await unifiedGenerate(config, { contents: 'prompt', model: 'gemini-2.5-flash' });

            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body as string);

            // Expect it to override 'gemini-2.5-flash' with 'GLM-4.7'
            expect(body.model).toBe('GLM-4.7');
        });

        it('should retry Gemini calls on 429/503 errors', async () => {
            const config: AppConfig = { llmProvider: 'gemini', githubToken: '', repoUrl: '', selectedRuns: [], devEnv: 'simulation', checkEnv: 'simulation' };

            // Fail once with 503, then succeed
            mocks.generateContent
                .mockRejectedValueOnce({ status: 503, message: 'Overloaded' })
                .mockResolvedValueOnce({ text: 'success after retry' });

            const res = await unifiedGenerate(config, { contents: 'prompt' });
            expect(res.text).toBe('success after retry');
            expect(mocks.generateContent).toHaveBeenCalledTimes(2);
        });

        it('should try fallback models if primary model returns 404', async () => {
            const config: AppConfig = { llmProvider: 'gemini', llmModel: 'gemini-non-existent', githubToken: '', repoUrl: '', selectedRuns: [], devEnv: 'simulation', checkEnv: 'simulation' };

            // First call fails with 404 (Not Found)
            mocks.generateContent.mockRejectedValueOnce({ status: 404, message: 'Model not found' });
            // Second call (Fallback to gemini-2.0-flash or similar) succeeds
            mocks.generateContent.mockResolvedValueOnce({ text: 'fallback response' });

            const res = await unifiedGenerate(config, { contents: 'prompt' });
            expect(res.text).toBe('fallback response');
            expect(mocks.generateContent).toHaveBeenCalledTimes(2);
        });
    });

    describe('toolLintCheck', () => {
        it('should parse valid JSON from LLM response', async () => {
            mocks.generateContent.mockResolvedValue({
                text: '```json\n{ "valid": false, "error": "Missing ;" }\n```'
            });

            const result = await toolLintCheck({} as any, "code", "js");
            expect(result.valid).toBe(false);
            expect(result.error).toBe("Missing ;");
        });

        it('should fail open (valid: true) if LLM fails or returns garbage', async () => {
            mocks.generateContent.mockResolvedValue({ text: "I am not sure" }); // Not JSON
            const result = await toolLintCheck({} as any, "code", "js");
            expect(result.valid).toBe(true);
        });
    });
});
