import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    refineProblemStatement, 
    groupFailedRuns, 
    diagnoseError,
    generateRepoSummary,
    generateFix,
    judgeFix,
    runSandboxTest
} from '../../../../services/analysis/LogAnalysisService';
import { unifiedGenerate, safeJsonParse } from '../../../../services/llm/LLMService';
import { runDevShellCommand } from '../../../../services/sandbox/SandboxService';

vi.mock('../../../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn((t, f) => {
        try { return JSON.parse(t); } catch { return f; }
    }),
    extractCode: vi.fn(t => t),
    recordLLMCall: vi.fn()
}));

vi.mock('../../../../services/sandbox/SandboxService', () => ({
    runDevShellCommand: vi.fn()
}));

vi.mock('../../../../utils/parsing', () => ({
    extractCodeBlock: vi.fn(t => t),
    extractCodeBlockStrict: vi.fn(t => t)
}));

vi.mock('../../../../services/analysis/BunErrorPattern.js', () => ({
    BunErrorPattern: {
        diagnose: vi.fn().mockImplementation((log) => ({
            isBunError: log.includes('Cannot bundle built-in module bun:test'),
            description: 'Bun issue'
        }))
    }
}));

describe('LogAnalysisService Enhanced', () => {
    const mockConfig = { githubToken: 'token' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('refineProblemStatement', () => {
        it('should handle single feedback without previous statement', async () => {
            const diagnosis = { summary: 'Error' };
            const result = await refineProblemStatement(mockConfig as any, diagnosis as any, ['Failed']);
            expect(result).toContain('Error');
            expect(result).toContain('Previous attempt: Failed');
        });

        it('should fallback on error', async () => {
            vi.mocked(unifiedGenerate).mockRejectedValue(new Error('LLM fail'));
            const diagnosis = { summary: 'Error' };
            const result = await refineProblemStatement(mockConfig as any, diagnosis as any, ['F1', 'F2']);
            expect(result).toContain('Key learnings: F1; F2');
        });
    });

    describe('diagnoseError', () => {
        it('should handle missing profile and classification', async () => {
            vi.mocked(unifiedGenerate).mockResolvedValue({ text: JSON.stringify({ summary: 'Sum', filePath: 'f.ts' }) });
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.summary).toBe('Sum');
        });

        it('should handle various JSON result structures', async () => {
            vi.mocked(unifiedGenerate).mockResolvedValue({ text: JSON.stringify({ result: { summary: 'From Result' } }) });
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.summary).toBe('From Result');
        });

        it('should clean suggested command labels', async () => {
            vi.mocked(unifiedGenerate).mockResolvedValue({ 
                text: JSON.stringify({ summary: 'S', suggestedCommand: 'Action: npm test' }) 
            });
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.suggestedCommand).toBe('npm test');
        });

        it('should clean suggested command with multiline logic and no keywords', async () => {
            vi.mocked(unifiedGenerate).mockResolvedValue({ 
                text: JSON.stringify({ summary: 'S', suggestedCommand: 'Description line\nActual Command' }) 
            });
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.suggestedCommand).toBe('Actual Command');
        });

        it('should handle colon in command that is not a description', async () => {
            vi.mocked(unifiedGenerate).mockResolvedValue({ 
                text: JSON.stringify({ summary: 'S', suggestedCommand: 'echo "Value: 123"' }) 
            });
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.suggestedCommand).toBe('echo "Value: 123"');
        });

        it('should unquote suggested command', async () => {
            vi.mocked(unifiedGenerate).mockResolvedValue({ 
                text: JSON.stringify({ summary: 'S', suggestedCommand: '"npm test"' }) 
            });
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.suggestedCommand).toBe('npm test');
        });

        it('should handle exceptions', async () => {
            vi.mocked(unifiedGenerate).mockRejectedValue(new Error('crash'));
            const result = await diagnoseError(mockConfig as any, 'logs');
            expect(result.summary).toBe('Diagnosis Failed');
        });
    });

    describe('runSandboxTest bun retry', () => {
        it('should retry with bun test on Bun-specific error', async () => {
            const mockSandbox = { 
                runCommand: vi.fn().mockImplementation(async (cmd) => {
                    if (cmd.startsWith('ls ')) return { exitCode: 0, stdout: '' };
                    if (cmd.includes('npm run test') || cmd.includes('vitest')) {
                        return { stdout: 'FAIL: Cannot bundle built-in module bun:test', exitCode: 1 };
                    }
                    if (cmd.includes('bun test')) return { stdout: 'success', exitCode: 0 };
                    return { exitCode: 0, stdout: '' };
                }),
                writeFile: vi.fn().mockResolvedValue(undefined)
            };
            const result = await runSandboxTest(mockConfig as any, {} as any, 1, true, { path: 'f.ts', modified: { content: 'c' } } as any, 'goal', vi.fn(), {}, mockSandbox as any);
            expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringContaining('bun test'));
            expect(result.passed).toBe(true);
        });
    });

    describe('generateRepoSummary', () => {
        it('should handle undefined sandbox', async () => {
            const result = await generateRepoSummary(mockConfig as any);
            expect(result).toContain('Simulation Mode');
        });

        it('should handle read failures', async () => {
            const mockSandbox = {};
            vi.mocked(runDevShellCommand)
                .mockResolvedValueOnce({ output: 'file.txt', exitCode: 0 }) // find
                .mockResolvedValueOnce({ output: 'README content', exitCode: 0 }) // readme
                .mockResolvedValueOnce({ output: '', exitCode: 1 }); // package.json fails
            
            const result = await generateRepoSummary(mockConfig as any, mockSandbox as any);
            expect(result).toContain('file.txt');
            expect(result).toContain('README content');
        });
    });

    describe('generateFix', () => {
        it('should handle extra context and continuation loop', async () => {
            vi.mocked(unifiedGenerate)
                .mockResolvedValueOnce({ text: 'code part 1' })
                .mockResolvedValueOnce({ text: 'code part 2' })
                .mockResolvedValueOnce({ text: 'code part 3```' });
            
            const result = await generateFix(mockConfig as any, { code: 'c', error: 'e', extraContext: 'extra' });
            expect(result).toBe('code part 1code part 2code part 3```');
        });
    });

    describe('judgeFix', () => {
        it('should return 0 if no changes made', async () => {
            const result = await judgeFix(mockConfig as any, 'same', 'same', 'e');
            expect(result.passed).toBe(false);
            expect(result.score).toBe(0);
        });

        it('should fallback on error', async () => {
            vi.mocked(unifiedGenerate).mockRejectedValue(new Error('fail'));
            const result = await judgeFix(mockConfig as any, 'orig', 'fix', 'e');
            expect(result.passed).toBe(true);
            expect(result.score).toBe(5);
        });
    });

    describe('runSandboxTest', () => {
        it('should handle missing sandbox in e2b mode', async () => {
            const result = await runSandboxTest({ checkEnv: 'e2b' } as any, {} as any, 1, true, { path: 'f.ts' } as any, 'goal', vi.fn(), {});
            expect(result.passed).toBe(false);
            expect(result.logs).toContain('Sandbox not available');
        });

        it('should skip test generation for test files', async () => {
            const mockSandbox = { 
                runCommand: vi.fn().mockResolvedValue({ stdout: 'ok', exitCode: 0 }),
                writeFile: vi.fn().mockResolvedValue(undefined)
            };
            const result = await runSandboxTest({} as any, {} as any, 1, true, { path: 'src/app.test.ts', modified: { content: 'c' } } as any, 'goal', vi.fn(), {}, mockSandbox as any);
            expect(mockSandbox.runCommand).not.toHaveBeenCalledWith(expect.stringContaining('ls'));
            expect(result.passed).toBe(true);
        });

        it('should use provided testCommand', async () => {
            const mockSandbox = { 
                runCommand: vi.fn().mockResolvedValue({ stdout: 'ok', exitCode: 0 }),
                writeFile: vi.fn().mockResolvedValue(undefined)
            };
            const result = await runSandboxTest({} as any, {} as any, 1, true, { path: 'f.ts', modified: { content: 'c' } } as any, 'goal', vi.fn(), {}, mockSandbox as any, 'custom test');
            expect(mockSandbox.runCommand).toHaveBeenCalledWith('custom test');
            expect(result.passed).toBe(true);
        });

        it('should handle push failure in github_actions mode', async () => {
            const config = { checkEnv: 'github_actions' };
            const group = { mainRun: { head_branch: 'main' } };
            // Mock pushMultipleFilesToGitHub - but it's not exported, it's imported in LogAnalysisService
            // We need to mock the whole module or just rely on current behavior
            const result = await runSandboxTest(config as any, group as any, 1, true, { path: 'f.ts', modified: { content: 'c' } } as any, 'goal', vi.fn(), {});
            expect(result.passed).toBe(false);
            expect(result.logs).toContain('Push failed');
        });
    });
});
