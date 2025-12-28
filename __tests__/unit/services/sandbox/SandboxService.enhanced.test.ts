import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    validateE2BApiKey, 
    runDevShellCommand, 
    prepareSandbox,
    toolCodeSearch,
    toolSemanticCodeSearch,
    toolRunCodeMode,
    toolLintCheck,
    toolLSPReferences,
    toolWebSearch,
    testE2BConnection
} from '../../../../services/sandbox/SandboxService';
import { SimulationSandbox } from '../../../../sandbox';
import * as yaml from 'js-yaml';

vi.mock('js-yaml');
vi.mock('@e2b/code-interpreter', () => ({
    Sandbox: {
        create: vi.fn()
    }
}));
vi.mock('../../../../sandbox', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        createSandbox: vi.fn()
    };
});

// Mock LLM Service
vi.mock('../../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn((t, f) => {
        try { return JSON.parse(t); } catch { return f; }
    }),
    retryWithBackoff: vi.fn(fn => fn())
}));

import { createSandbox } from '../../../../sandbox';
import { unifiedGenerate } from '../../../../services/llm/LLMService';
import { Sandbox } from '@e2b/code-interpreter';

describe('SandboxService Enhanced', () => {
    let mockSandbox: any;
    const mockConfig = {
        githubToken: 'gh_token',
        e2bApiKey: 'e2b_12345678901234567890'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockSandbox = {
            init: vi.fn(),
            getId: vi.fn().mockReturnValue('mock-id'),
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
            writeFile: vi.fn().mockResolvedValue(undefined),
            readFile: vi.fn().mockResolvedValue(''),
            kill: vi.fn()
        };
        (createSandbox as any).mockReturnValue(mockSandbox);
    });

    describe('validateE2BApiKey', () => {
        it('should reject various invalid formats', () => {
            expect(validateE2BApiKey('').valid).toBe(false);
            expect(validateE2BApiKey('no_prefix').valid).toBe(false);
            expect(validateE2BApiKey('e2b_short').valid).toBe(false);
            expect(validateE2BApiKey('e2b_has space ').valid).toBe(false);
        });
    });

    describe('runDevShellCommand', () => {
        it('should handle undefined sandbox', async () => {
            const result = await runDevShellCommand({} as any, 'ls');
            expect(result.output).toContain('[SIMULATION]');
        });

        it('should handle execution exception', async () => {
            mockSandbox.runCommand.mockRejectedValue(new Error('crash'));
            const result = await runDevShellCommand({} as any, 'ls', mockSandbox);
            expect(result.exitCode).toBe(1);
            expect(result.output).toContain('Execution Exception');
        });
    });

    describe('prepareSandbox error paths', () => {
        it('should throw if init fails', async () => {
            mockSandbox.init.mockRejectedValue(new Error('init fail'));
            await expect(prepareSandbox(mockConfig as any, 'owner/repo')).rejects.toThrow('init fail');
        });

        it('should handle git clone failure', async () => {
            mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 1, stderr: 'clone fail' }); // clone
            await expect(prepareSandbox(mockConfig as any, 'owner/repo')).rejects.toThrow('Git clone failed');
        });

        it('should handle git checkout retry logic', async () => {
            mockSandbox.runCommand
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 0 }) // clone
                .mockRejectedValueOnce(new Error('fetch fail')) // fetch sha
                .mockResolvedValueOnce({ exitCode: 1, stderr: 'checkout fail' }) // first checkout
                .mockResolvedValueOnce({ exitCode: 0 }) // fetch all
                .mockResolvedValueOnce({ exitCode: 0 }) // retry checkout
                .mockResolvedValue({ stdout: '', exitCode: 0 }); // dependency checks

            const sb = await prepareSandbox(mockConfig as any, 'owner/repo', 'sha123');
            expect(sb).toBe(mockSandbox);
        });

        it('should handle repoUrl with dots', async () => {
            mockSandbox.runCommand.mockResolvedValue({ exitCode: 0, stdout: '' });
            await prepareSandbox(mockConfig as any, 'my.git.server/repo');
            // Should not prepend github.com
        });
    });

    describe('toolCodeSearch', () => {
        it('should handle definition search', async () => {
            mockSandbox.runCommand.mockResolvedValue({
                stdout: `src/app.ts:class MyApp {}\n`,
                exitCode: 0
            });
            const result = await toolCodeSearch({} as any, 'MyApp', mockSandbox, 'def');
            expect(result).toEqual(['src/app.ts']);
        });

        it('should return empty array if output is empty', async () => {
            mockSandbox.runCommand.mockResolvedValue({ stdout: '', exitCode: 0 });
            const result = await toolCodeSearch({} as any, 'query', mockSandbox);
            expect(result).toEqual([]);
        });
    });

    describe('toolSemanticCodeSearch', () => {
        it('should return basic candidates if LLM rerank fails', async () => {
            mockSandbox.runCommand.mockResolvedValue({
                stdout: `file1.ts:match\n`,
                exitCode: 0
            });
            (unifiedGenerate as any).mockRejectedValue(new Error('LLM fail'));
            
            const result = await toolSemanticCodeSearch(mockConfig as any, 'query', mockSandbox);
            expect(result).toEqual(['file1.ts']);
        });

        it('should return empty array if no candidates found', async () => {
            mockSandbox.runCommand.mockResolvedValue({ stdout: '', exitCode: 0 });
            const result = await toolSemanticCodeSearch(mockConfig as any, 'query', mockSandbox);
            expect(result).toEqual([]);
        });
    });

    describe('toolRunCodeMode', () => {
        it('should record hallucinations if found in output', async () => {
            const output = `some logs\n[PATH_NOT_FOUND] {"path": "missing.ts"}\n`;
            mockSandbox.runCommand.mockResolvedValue({
                stdout: output,
                exitCode: 0
            });
            const loopDetector = { recordHallucination: vi.fn() };
            
            await toolRunCodeMode({} as any, 'script', mockSandbox, loopDetector as any);
            expect(loopDetector.recordHallucination).toHaveBeenCalledWith('missing.ts');
        });
    });

    describe('toolLintCheck', () => {
        it('should handle TSC failure', async () => {
            mockSandbox.runCommand.mockResolvedValue({
                stdout: 'error TS1234: bad code',
                exitCode: 1
            });
            const result = await toolLintCheck({} as any, 'const x: int = "a";', 'typescript', mockSandbox);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('[TSC Type Error]');
        });

        it('should handle YAML syntax error', async () => {
            (yaml.load as any).mockImplementation(() => { throw new Error('bad yaml'); });
            const result = await toolLintCheck({} as any, 'bad: :', 'yaml', mockSandbox);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('[YAML Syntax Error]');
        });
    });

    describe('toolWebSearch', () => {
        it('should fallback to Google Search if Tavily fails', async () => {
            const configWithTavily = { ...mockConfig, tavilyApiKey: 't_123' };
            // Mock global fetch
            global.fetch = vi.fn().mockRejectedValue(new Error('Network fail'));
            (unifiedGenerate as any).mockResolvedValue({ text: 'Google search results' });

            const result = await toolWebSearch(configWithTavily as any, 'query');
            expect(result).toBe('Google search results');
        });
    });

    describe('testE2BConnection errors', () => {
        it('should handle authentication errors', async () => {
            const { Sandbox } = await import('@e2b/code-interpreter');
            vi.mocked(Sandbox.create).mockRejectedValue(new Error('401 Unauthorized'));
            const result = await testE2BConnection('e2b_12345678901234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Authentication Failed');
        });

        it('should handle timeout errors', async () => {
            const { Sandbox } = await import('@e2b/code-interpreter');
            vi.mocked(Sandbox.create).mockRejectedValue(new Error('Request Timeout'));
            const result = await testE2BConnection('e2b_12345678901234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Connection Timeout');
        });

        it('should handle E2B execution error', async () => {
            const { Sandbox } = await import('@e2b/code-interpreter');
            const mockSbObj = {
                runCode: vi.fn().mockResolvedValue({ error: { value: 'crash' }, logs: { stdout: [], stderr: [] } }),
                kill: vi.fn()
            };
            vi.mocked(Sandbox.create).mockResolvedValue(mockSbObj as any);
            const result = await testE2BConnection('e2b_12345678901234567890');
            expect(result.success).toBe(false);
            expect(result.message).toContain('E2B Execution Error');
        });
    });
});
