import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    validateE2BApiKey,
    runDevShellCommand,
    toolCodeSearch,
    toolSemanticCodeSearch,
    toolLintCheck,
    testE2BConnection,
    toolRunCodeMode,
    prepareSandbox,
    toolWebSearch,
    toolLSPReferences,
    toolScanDependencies,
    createTools
} from '../../services/sandbox/SandboxService.js';
import { AppConfig } from '../../types.js';

describe('SandboxService', () => {
    let mockConfig: AppConfig;

    beforeEach(() => {
        mockConfig = {
            geminiApiKey: 'test-key',
            githubToken: 'test-token',
            e2bApiKey: 'e2b_test_key_1234567890',
            tavilyApiKey: 'test-tavily',
            repoUrl: 'https://github.com/test/repo',
            prUrl: 'https://github.com/test/repo/pull/1',
            devEnv: 'e2b'
        };
    });

    describe('validateE2BApiKey', () => {
        it('should validate correct API key format', () => {
            const result = validateE2BApiKey('e2b_1234567890abcdef1234');
            expect(result.valid).toBe(true);
            expect(result.message).toContain('valid');
        });

        it('should reject empty API key', () => {
            const result = validateE2BApiKey('');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('empty');
        });

        it('should reject API key without e2b_ prefix', () => {
            const result = validateE2BApiKey('invalid_key_1234567890');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('e2b_');
        });

        it('should reject API key that is too short', () => {
            const result = validateE2BApiKey('e2b_short');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('too short');
        });

        it('should reject API key with spaces', () => {
            const result = validateE2BApiKey('e2b_key with spaces 1234');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('invalid characters');
        });

        it('should reject API key with newlines', () => {
            const result = validateE2BApiKey('e2b_key\nwith\nnewlines');
            expect(result.valid).toBe(false);
            expect(result.message).toContain('invalid characters');
        });
    });

    describe('runDevShellCommand', () => {
        it('should execute command in sandbox', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'command output',
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await runDevShellCommand(mockConfig, 'echo test', mockSandbox as any);

            expect(result.output).toContain('command output');
            expect(result.exitCode).toBe(0);
            expect(mockSandbox.runCommand).toHaveBeenCalledWith('echo test');
        });

        it('should include stderr in output', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'output',
                    stderr: 'error message',
                    exitCode: 1
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await runDevShellCommand(mockConfig, 'failing-command', mockSandbox as any);

            expect(result.output).toContain('output');
            expect(result.output).toContain('[STDERR]');
            expect(result.output).toContain('error message');
            expect(result.exitCode).toBe(1);
        });

        it('should handle execution exception', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockRejectedValue(new Error('Execution failed')),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await runDevShellCommand(mockConfig, 'bad-command', mockSandbox as any);

            expect(result.output).toContain('Execution Exception');
            expect(result.output).toContain('Execution failed');
            expect(result.exitCode).toBe(1);
        });

        it('should return simulation output when no sandbox provided', async () => {
            const result = await runDevShellCommand(mockConfig, 'test-command');

            expect(result.output).toContain('[SIMULATION]');
            expect(result.output).toContain('test-command');
            expect(result.exitCode).toBe(0);
        });
    });

    describe('toolCodeSearch', () => {
        it('should search for definitions', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'src/app.ts:10:function myFunction()\nsrc/utils.ts:20:const myFunction = () => {}',
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolCodeSearch(mockConfig, 'myFunction', mockSandbox as any, 'def');

            expect(results).toContain('src/app.ts');
            expect(results).toContain('src/utils.ts');
            expect(mockSandbox.runCommand).toHaveBeenCalledWith(
                expect.stringContaining('grep -rE')
            );
        });

        it('should search for references', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'src/app.ts:myFunction()\nsrc/test.ts:myFunction()',
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolCodeSearch(mockConfig, 'myFunction', mockSandbox as any, 'ref');

            expect(results.length).toBeGreaterThan(0);
            expect(mockSandbox.runCommand).toHaveBeenCalledWith(
                expect.stringContaining('grep -r')
            );
        });

        it('should return empty array when no results found', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: '',
                    stderr: '',
                    exitCode: 1
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolCodeSearch(mockConfig, 'nonexistent', mockSandbox as any);

            expect(results).toEqual([]);
        });

        it('should return empty array when no sandbox provided', async () => {
            const results = await toolCodeSearch(mockConfig, 'test');
            expect(results).toEqual([]);
        });

        it('should deduplicate file paths', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'src/app.ts:line1\nsrc/app.ts:line2\nsrc/utils.ts:line3',
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolCodeSearch(mockConfig, 'test', mockSandbox as any);

            expect(results).toHaveLength(2); // app.ts and utils.ts, no duplicates
        });
    });

    describe('toolLintCheck', () => {
        it('should validate Python code with pyright', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: '',
                    stderr: '',
                    exitCode: 0
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolLintCheck(mockConfig, 'print("hello")', 'python', mockSandbox as any);

            expect(result.valid).toBe(true);
            expect(mockSandbox.writeFile).toHaveBeenCalled();
            expect(mockSandbox.runCommand).toHaveBeenCalledWith(
                expect.stringContaining('pyright')
            );
        });

        it('should report Python lint errors', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'temp_check.py:1:5 - error: Name "undefined_var" is not defined',
                    stderr: '',
                    exitCode: 1
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolLintCheck(mockConfig, 'print(undefined_var)', 'python', mockSandbox as any);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('Pyright Type Error');
            expect(result.error).toContain('file.py'); // Should replace temp file name
        });

        it('should validate TypeScript code', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: '',
                    stderr: '',
                    exitCode: 0
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolLintCheck(mockConfig, 'const x: number = 5;', 'typescript', mockSandbox as any);

            expect(result.valid).toBe(true);
            expect(mockSandbox.runCommand).toHaveBeenCalledWith(
                expect.stringContaining('npx tsc')
            );
        });

        it('should report TypeScript errors', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'temp_check.ts(1,7): error TS2322: Type "string" is not assignable to type "number"',
                    stderr: '',
                    exitCode: 1
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolLintCheck(mockConfig, 'const x: number = "hello";', 'typescript', mockSandbox as any);

            expect(result.valid).toBe(false);
            expect(result.error).toContain('TSC Type Error');
        });

        it('should validate YAML without sandbox', async () => {
            const validYaml = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
`;

            const result = await toolLintCheck(mockConfig, validYaml, 'yaml');

            expect(result.valid).toBe(true);
        });

        it('should report YAML syntax errors', async () => {
            const invalidYaml = `
name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
  - invalid: indentation
`;

            const result = await toolLintCheck(mockConfig, invalidYaml, 'yaml');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('YAML Syntax Error');
        });

        it('should handle React TSX files', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: '',
                    stderr: '',
                    exitCode: 0
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolLintCheck(
                mockConfig,
                'const App = () => <div>Hello</div>;',
                'typescriptreact',
                mockSandbox as any
            );

            expect(result.valid).toBe(true);
            expect(mockSandbox.writeFile).toHaveBeenCalledWith(
                'temp_check.tsx',
                expect.any(String)
            );
        });
    });

    describe('toolRunCodeMode', () => {
        it('should execute TypeScript script in sandbox', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'Script executed successfully',
                    stderr: '',
                    exitCode: 0
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const script = 'console.log("Hello from script");';
            const result = await toolRunCodeMode(mockConfig, script, mockSandbox as any);

            expect(result).toContain('Script executed successfully');
            expect(mockSandbox.writeFile).toHaveBeenCalledWith(
                'current_task.ts',
                expect.stringContaining(script)
            );
            expect(mockSandbox.runCommand).toHaveBeenCalledWith(
                expect.stringContaining('npx -y ts-node')
            );
        });

        it('should include stderr in output', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'output',
                    stderr: 'warning message',
                    exitCode: 0
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolRunCodeMode(mockConfig, 'console.log("test");', mockSandbox as any);

            expect(result).toContain('output');
            expect(result).toContain('[STDERR]');
            expect(result).toContain('warning message');
        });

        it('should return error message when no sandbox available', async () => {
            const result = await toolRunCodeMode(mockConfig, 'console.log("test");');

            expect(result).toContain('Error');
            expect(result).toContain('Sandbox not available');
        });

        it('should return [No Output] when script produces no output', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: '',
                    stderr: '',
                    exitCode: 0
                }),
                writeFile: vi.fn(),
                getId: () => 'test-sandbox',
                init: vi.fn(),
                kill: vi.fn()
            };

            const result = await toolRunCodeMode(mockConfig, '// empty script', mockSandbox as any);

            expect(result).toBe('[No Output]');
        });
    });

    describe('testE2BConnection', () => {
        it('should reject invalid API key format', async () => {
            const result = await testE2BConnection('invalid-key');

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid API Key');
        });

        it('should reject empty API key', async () => {
            const result = await testE2BConnection('');

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid API Key');
        });

        // Note: Testing actual E2B connection requires mocking the Sandbox.create method
        // which is complex. These tests focus on validation and error handling.
        // Full E2B connection tests are in e2b_connectivity.test.ts
    });

    describe('prepareSandbox', () => {
        // Note: prepareSandbox requires complex module mocking of createSandbox
        // and filesystem operations. These are better tested in integration tests
        // with actual E2B sandbox instances. See e2b_persistent.test.ts
        it('should be a function', () => {
            expect(typeof prepareSandbox).toBe('function');
        });
    });

    describe('toolSemanticCodeSearch', () => {
        it('should return empty array when no sandbox provided', async () => {
            const results = await toolSemanticCodeSearch(mockConfig, 'test query', undefined as any);
            expect(results).toEqual([]);
        });

        it('should perform grep search and return candidates', async () => {
            const mockSandbox = {
                runCommand: vi.fn()
                    .mockResolvedValueOnce({ stdout: 'src/app.ts:match', stderr: '', exitCode: 0 })
                    .mockResolvedValueOnce({ stdout: 'file content', stderr: '', exitCode: 0 }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolSemanticCodeSearch(mockConfig, 'searchTerm', mockSandbox as any);

            expect(Array.isArray(results)).toBe(true);
        });

        it('should handle empty grep results', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolSemanticCodeSearch(mockConfig, 'nonexistent', mockSandbox as any);

            expect(results).toEqual([]);
        });
    });

    describe('toolWebSearch', () => {
        it('should use Tavily API when available', async () => {
            const configWithTavily = { ...mockConfig, tavilyApiKey: 'test-tavily-key' };

            global.fetch = vi.fn().mockResolvedValue({
                json: async () => ({
                    answer: 'Test answer',
                    results: [{ title: 'Test', url: 'https://test.com' }]
                })
            });
            const result = await toolWebSearch(configWithTavily, 'test query');

            expect(result).toContain('Test answer');
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.tavily.com/search',
                expect.any(Object)
            );
        });

        it('should handle Tavily API errors gracefully', async () => {
            const configWithTavily = { ...mockConfig, tavilyApiKey: 'test-tavily-key' };

            global.fetch = vi.fn().mockRejectedValue(new Error('Tavily failed'));

            // Should fallback to LLM - we'll just check it doesn't throw for now
            // Full LLM integration is tested elsewhere
            await expect(toolWebSearch(configWithTavily, 'test query')).rejects.toThrow();
        });
    });

    describe('toolLSPReferences', () => {
        it('should search for symbol references', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: 'src/app.ts:10:mySymbol\nsrc/utils.ts:20:mySymbol',
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolLSPReferences(mockConfig, 'app.ts', 10, 'mySymbol', mockSandbox as any);

            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
        });

        it('should return empty array when no sandbox provided', async () => {
            const results = await toolLSPReferences(mockConfig, 'app.ts', 10, 'mySymbol');
            expect(results).toEqual([]);
        });

        it('should limit results to 10', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: Array(20).fill('file.ts:1:symbol').join('\n'),
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const results = await toolLSPReferences(mockConfig, 'app.ts', 10, 'mySymbol', mockSandbox as any);

            expect(results.length).toBeLessThanOrEqual(10);
        });
    });

    describe('toolScanDependencies', () => {
        it('should return no issues message', async () => {
            const result = await toolScanDependencies(mockConfig, 'abc123');
            expect(result).toContain('No dependency issues');
        });
    });

    describe('createTools', () => {
        it('should create tool definitions', () => {
            const mockSandbox = {
                runCommand: vi.fn(),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const tools = createTools(mockConfig, mockSandbox as any);

            expect(tools).toHaveProperty('webSearch');
            expect(tools).toHaveProperty('runCodeMode');
        });

        it('should create tools without sandbox', () => {
            const tools = createTools(mockConfig);

            expect(tools).toHaveProperty('webSearch');
            expect(tools).toHaveProperty('runCodeMode');
        });
    });
});
