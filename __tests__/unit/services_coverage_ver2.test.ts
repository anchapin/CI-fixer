import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { diagnoseError, toolLintCheck } from '../../services';
import { AppConfig } from '../../types';

describe('Services Coverage Verification', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    vi.mock('../../services/context-compiler', () => ({
        filterLogs: (l: string) => l,
        summarizeLogs: (l: string) => 'Summary: ' + l
    }));

    const config: AppConfig = {
        githubToken: 'test',
        repoUrl: 'owner/repo',
        llmProvider: 'openai',
        devEnv: 'simulation',
        customApiKey: 'key'
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        fetchSpy.mockReset();
    });

    afterAll(() => {
        fetchSpy.mockRestore();
    });

    describe('diagnoseError', () => {
        it('should use LLM output for diagnosis', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                summary: 'Detected error',
                                fixAction: 'edit',
                                filePath: 'src/main.ts',
                                reproductionCommand: 'npm test'
                            })
                        }
                    }]
                })
            } as Response);

            const result = await diagnoseError(config, 'Error log content');

            expect(result.summary).toBe('Detected error');
            expect(result.fixAction).toBe('edit');
            expect(result.filePath).toBe('src/main.ts');
        });

        it('should handle LLM JSON parsing failure gracefully', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'Invalid JSON response' } }]
                })
            } as Response);

            const result = await diagnoseError(config, 'Error log');

            // Implementation falls back to "Unknown Error" on parse failure
            expect(result.summary).toBe('Unknown Error');
        });

        it('should include profile context in prompt', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: '{}' } }] })
            } as Response);

            await diagnoseError(config, 'log', 'repoContext', { languages: ['TypeScript'] } as any);

            const callArgs = fetchSpy.mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body as string);
            expect(body.messages[0].content).toContain('=== REPOSITORY PROFILE ===');
        });
    });

    describe('toolLintCheck', () => {
        let mockSandbox: any;

        beforeEach(() => {
            mockSandbox = {
                writeFile: vi.fn(),
                runCommand: vi.fn()
            };
        });

        it('should use Sandbox for Python linting', async () => {
            mockSandbox.runCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

            const res = await toolLintCheck(config, 'print("hi")', 'python', mockSandbox);
            expect(res.valid).toBe(true);
        });

        it('should report Python lint errors', async () => {
            mockSandbox.runCommand.mockResolvedValue({
                exitCode: 1,
                stdout: 'temp_check.py:1: error: Bad syntax',
                stderr: ''
            });

            const res = await toolLintCheck(config, 'err', 'python', mockSandbox);
            expect(res.valid).toBe(false);
            expect(res.error).toContain('[Pyright Type Error]');
        });

        it('should fallback to LLM for unknown languages', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ choices: [{ message: { content: '{"valid": true}' } }] })
            } as Response);

            const res = await toolLintCheck(config, 'code', 'ruby', undefined);

            expect(res.valid).toBe(true);
            expect(fetchSpy).toHaveBeenCalled();
        });

        it('should validate YAML using js-yaml', async () => {
            const res = await toolLintCheck(config, 'key: value', 'yaml');
            expect(res.valid).toBe(true);
        });

        it('should catch invalid YAML', async () => {
            const res = await toolLintCheck(config, 'key: : value', 'yaml');
            expect(res.valid).toBe(false);
        });
    });
});
