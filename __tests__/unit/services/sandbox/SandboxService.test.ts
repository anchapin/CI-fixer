
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    validateE2BApiKey,
    runDevShellCommand,
    prepareSandbox,
    toolCodeSearch,
    createTools,
    testE2BConnection
} from '../../../../services/sandbox/SandboxService.js';
import * as sandboxModule from '../../../../sandbox.js';
import * as llmService from '../../../../services/llm/LLMService.js';

// Mock E2B
vi.mock('@e2b/code-interpreter', () => ({
    Sandbox: {
        create: vi.fn(),
    }
}));

// Mock sandbox.js
vi.mock('../../../../sandbox.js', () => ({
    createSandbox: vi.fn(),
    SandboxEnvironment: class {
        init() { return Promise.resolve(); }
        runCommand() { return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }); }
        writeFile() { return Promise.resolve(); }
        getId() { return 'mock-sandbox-id'; }
    }
}));

// Mock LLM Service
vi.mock('../../../../services/llm/LLMService.js', () => ({
    retryWithBackoff: vi.fn((fn) => fn()),
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn((text, fallback) => fallback),
}));

// Mock fs/promises for agent tools injection
vi.mock('fs/promises', () => ({
    readFile: vi.fn().mockResolvedValue('// mock agent tools content'),
}));

describe('SandboxService', () => {
    const mockConfig = {
        githubToken: 'test-token',
        openaiApiKey: 'test-key',
        e2bApiKey: 'e2b_test_key_1234567890',
        redisUrl: 'redis://localhost:6379',
        repoUrl: 'owner/repo'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validateE2BApiKey', () => {
        it('should return valid for correct key format', () => {
            const result = validateE2BApiKey('e2b_12345678901234567890');
            expect(result.valid).toBe(true);
        });

        it('should fail for empty key', () => {
            const result = validateE2BApiKey('');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('empty');
        });

        it('should fail for wrong prefix', () => {
            const result = validateE2BApiKey('sk_12345678901234567890');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('must start with "e2b_"');
        });

        it('should fail for short key', () => {
            const result = validateE2BApiKey('e2b_short');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('too short');
        });
    });

    describe('runDevShellCommand', () => {
        it('should execute command on sandbox if provided', async () => {
            const mockRunCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' });
            const mockSandbox: any = { runCommand: mockRunCommand };

            const result = await runDevShellCommand(mockConfig, 'ls -la', mockSandbox);

            expect(mockRunCommand).toHaveBeenCalledWith('ls -la');
            expect(result.exitCode).toBe(0);
            expect(result.output).toBe('output');
        });

        it('should handle execution errors gracefully', async () => {
            const mockSandbox: any = {
                runCommand: vi.fn().mockRejectedValue(new Error('Sandbox offline'))
            };

            const result = await runDevShellCommand(mockConfig, 'ls', mockSandbox);
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain('Execution Exception');
        });
    });

    describe('prepareSandbox', () => {
        it('should initialize, clone, and checkout repo', async () => {
            const mockSandboxInstance = {
                init: vi.fn().mockResolvedValue(undefined),
                getId: () => 'id',
                runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'package.json', stderr: '' }),
                writeFile: vi.fn().mockResolvedValue(undefined)
            };
            (sandboxModule.createSandbox as any).mockReturnValue(mockSandboxInstance);

            await prepareSandbox(mockConfig, 'https://github.com/owner/repo', 'main');

            expect(sandboxModule.createSandbox).toHaveBeenCalledWith(mockConfig);
            expect(mockSandboxInstance.init).toHaveBeenCalled();
            // Expect git clone
            expect(mockSandboxInstance.runCommand).toHaveBeenCalledWith(expect.stringMatching(/git clone/));
            // Expect git checkout
            expect(mockSandboxInstance.runCommand).toHaveBeenCalledWith(expect.stringMatching(/git fetch.*main/));
            expect(mockSandboxInstance.runCommand).toHaveBeenCalledWith(expect.stringMatching(/git checkout.*main/));
            // Expect dependency install
            expect(mockSandboxInstance.runCommand).toHaveBeenCalledWith(expect.stringMatching(/npm install/));
            // Expect hadolint installation
            expect(mockSandboxInstance.runCommand).toHaveBeenCalledWith(expect.stringMatching(/hadolint/));
            // Expect agent tools injection
            expect(mockSandboxInstance.writeFile).toHaveBeenCalledWith('agent_tools.ts', expect.any(String));
        });
    });

    describe('toolCodeSearch', () => {
        it('should run grep command', async () => {
            const mockRunCommand = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'file.ts:match\nother.ts:match', stderr: '' });
            const mockSandbox: any = { runCommand: mockRunCommand };

            const results = await toolCodeSearch(mockConfig, 'functionName', mockSandbox, 'def');

            expect(mockRunCommand).toHaveBeenCalledWith(expect.stringContaining('grep'));
            expect(results).toContain('file.ts');
            expect(results).toContain('other.ts');
        });
    });

    describe('createTools', () => {
        it('should return tool definitions', () => {
            const tools = createTools(mockConfig);
            expect(tools).toHaveProperty('webSearch');
            expect(tools).toHaveProperty('runCodeMode');
        });

        it('should execute webSearch tool', async () => {
            // Mock toolWebSearch to be imported? No it's exported from same file.
            // We can't spy on it easily if it's a direct call within module unless we modify how it's called or mock the module itself.
            // However, we can mock the `unifiedGenerate` which `toolWebSearch` calls, or `toolWebSearch` itself if we import * as Service.

            // Let's rely on the fact that `toolWebSearch` calls `unifiedGenerate`
            (llmService.unifiedGenerate as any).mockResolvedValue({ text: 'search result' });

            const tools = createTools(mockConfig);
            const result = await (tools.webSearch as any).execute({ query: 'test' });
            expect(result).toBe('search result');
        });

        it('should execute runCodeMode tool', async () => {
            const mockSandbox: any = {
                runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'script output', stderr: '' }),
                writeFile: vi.fn().mockResolvedValue(undefined)
            };

            const tools = createTools(mockConfig, mockSandbox);
            const result = await (tools.runCodeMode as any).execute({ script: 'console.log("hi")' });
            expect(result).toBe('script output');
        });
    });

    describe('testE2BConnection', () => {
        it('should return success when connection verified', async () => {
            // Mock retryWithBackoff to return a mock sandbox that passes validaton
            (llmService.retryWithBackoff as any).mockImplementation(async (fn: any) => {
                return {
                    runCode: async () => ({ logs: { stdout: ['Connection Verified'], stderr: [] }, error: null }),
                    kill: async () => { }
                };
            });

            const result = await testE2BConnection('e2b_valid_key_1234567890');
            expect(result.success).toBe(true);
        });

        it('should return failure on invalid key format', async () => {
            const result = await testE2BConnection('invalid');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid API Key');
        });

        it('should handle output mismatch in verification', async () => {
            (llmService.retryWithBackoff as any).mockImplementation(async (fn: any) => {
                return {
                    runCode: async () => ({ logs: { stdout: ['Wrong Output'], stderr: [] }, error: null }),
                    kill: async () => { }
                };
            });

            const result = await testE2BConnection('e2b_testing_key_1234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Unexpected command output');
        });

        it('should handle execution errors in verification', async () => {
            (llmService.retryWithBackoff as any).mockImplementation(async (fn: any) => {
                return {
                    runCode: async () => ({ logs: { stdout: [], stderr: [] }, error: { name: 'ExecError', value: 'bash error' } }),
                    kill: async () => { }
                };
            });

            const result = await testE2BConnection('e2b_testing_key_1234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('E2B Execution Error');
        });

        it('should handle network timeout/fetch errors', async () => {
            (llmService.retryWithBackoff as any).mockRejectedValue(new Error('Network request failed'));
            const result = await testE2BConnection('e2b_testing_key_1234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Network Connection Failed');
        });

        it('should handle authentication errors', async () => {
            (llmService.retryWithBackoff as any).mockRejectedValue(new Error('401 Unauthorized'));
            const result = await testE2BConnection('e2b_testing_key_1234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Authentication Failed');
        });

        it('should handle timeouts', async () => {
            (llmService.retryWithBackoff as any).mockRejectedValue(new Error('Connection timeout'));
            const result = await testE2BConnection('e2b_testing_key_1234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Connection Timeout');
        });

        it('should handle generic connection errors', async () => {
            (llmService.retryWithBackoff as any).mockRejectedValue(new Error('Unknown Error'));
            const result = await testE2BConnection('e2b_testing_key_1234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Connection Error');
        });

        it('should handle sandbox cleanup failure gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            (llmService.retryWithBackoff as any).mockImplementation(async (fn: any) => {
                return {
                    runCode: async () => ({ logs: { stdout: ['Connection Verified'], stderr: [] }, error: null }),
                    kill: async () => { throw new Error('Cleanup failed'); }
                };
            });

            await testE2BConnection('e2b_valid_key_1234567890');
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to kill test sandbox'), expect.any(Error));
        });
    });
});
