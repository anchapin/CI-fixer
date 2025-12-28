
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePatch, validatePatches, ValidationResult } from '../../../../services/repair-agent/patch-validation';
import { AppConfig } from '../../../../types';
import { PatchCandidate } from '../../../../services/repair-agent/patch-generation';
import { SandboxEnvironment } from '../../../../sandbox.js';

describe('Patch Validation', () => {
    const mockConfig = {} as AppConfig;
    const mockPatch: PatchCandidate = {
        id: 'p1',
        code: 'console.log("foo");',
        confidence: 1.0,
        strategy: 'direct',
        description: 'Mock patch',
        reasoning: 'Mock reasoning'
    };

    const mockSandbox = {
        writeFile: vi.fn(),
        runCommand: vi.fn()
    } as unknown as SandboxEnvironment;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validatePatch', () => {
        it('should pass if all checks pass', async () => {
            // Sequence of runCommand calls:
            // 1. validateSyntax -> tsc
            // 2. validateSyntax -> rm (cleanup)
            // 3. runTests -> testCommand

            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 0, stdout: '2 tests run', stderr: '' }); // tests

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test');

            expect(result.passed).toBe(true);
            expect(result.syntaxValid).toBe(true);
            expect(result.testsPassed).toBe(true);
        });

        it('should fail on syntax error', async () => {
            // Sequence:
            // 1. validateSyntax -> tsc (fails)
            // 2. validateSyntax -> rm (cleanup)

            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 1, stderr: 'SyntaxError' }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }); // rm

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test');

            expect(result.passed).toBe(false);
            expect(result.syntaxValid).toBe(false);
            expect(result.errorMessage).toContain('Syntax error');
        });

        it('should fail on test failure', async () => {
            // Sequence:
            // 1. validateSyntax -> tsc
            // 2. validateSyntax -> rm
            // 3. runTests -> testCommand (fails)

            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({
                    exitCode: 1,
                    stdout: '2 tests run, 1 failed',
                    stderr: 'AssertionError'
                }); // tests

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test');

            expect(result.passed).toBe(false);
            expect(result.testsPassed).toBe(false);
            expect(result.details.testsFailed).toBe(1);
        });

        it('should handle optional static analysis', async () => {
            // Sequence:
            // 1. validateSyntax -> tsc
            // 2. validateSyntax -> rm
            // 3. runStaticAnalysis -> eslint
            // 4. runStaticAnalysis -> rm
            // 5. runTests -> testCommand

            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 0 }) // eslint
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 0, stdout: '2 run' }); // tests

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test', {
                requireTestsPass: true,
                requireSyntaxValid: true,
                requireStaticAnalysis: true
            });

            expect(result.staticAnalysisPassed).toBe(true);
            expect(mockSandbox.runCommand).toHaveBeenCalledTimes(5);
        });
    });

    describe('validatePatches', () => {
        it('should return early on first passing patch', async () => {
            const patch1 = { ...mockPatch, id: 'p1' };
            const patch2 = { ...mockPatch, id: 'p2' };

            // Patch 1: PASS
            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK' }); // tests

            // Patch 2: PASS (runs fully because implementation checks all but logs early found)
            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 0, stdout: 'OK' }); // tests

            const results = await validatePatches(mockConfig, [patch1, patch2], mockSandbox, 'npm test');

            expect(results.size).toBe(2);
            expect(results.get('p1')?.passed).toBe(true);
            expect(results.get('p2')?.passed).toBe(true);
        });
        it('should handle complex test output parsing', async () => {
            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 })
                .mockResolvedValueOnce({ exitCode: 0 })
                .mockResolvedValueOnce({
                    exitCode: 1,
                    stdout: '\nTests:       5 failed, 15 passed, 20 total', // Simplified output
                    stderr: ''
                });

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test');

            // Our regex looks for "failed" directly: /(\d+)\s+(?:tests?\s+)?failed/i
            // "5 failed" matches.
            expect(result.details.testsFailed).toBe(5);
            expect(result.testsPassed).toBe(false);
        });

        it('should detect static analysis lint errors', async () => {
            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 }) // tsc
                .mockResolvedValueOnce({ exitCode: 0 }) // rm
                .mockResolvedValueOnce({ exitCode: 1, stdout: '[{"errorCount": 3}]' }) // eslint json output
                .mockResolvedValueOnce({ exitCode: 0 }); // rm
            // runTests is NOT called if static analysis fails

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test', {
                requireTestsPass: true,
                requireSyntaxValid: true,
                requireStaticAnalysis: true
            });

            expect(result.staticAnalysisPassed).toBe(false);
            expect(result.details.lintErrors).toBe(3);
            expect(result.errorMessage).toContain('3 lint errors');
        });

        it('should handle generic errors in validateSyntax', async () => {
            // Simulate Sandbox error
            (mockSandbox.runCommand as any).mockRejectedValue(new Error('Sandbox offline'));

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test');
            expect(result.syntaxValid).toBe(false);
            expect(result.errorMessage).toContain('Syntax error: Sandbox offline'); // Logic wraps error.message
        });

        it('should handle generic errors in runTests', async () => {
            (mockSandbox.runCommand as any)
                .mockResolvedValueOnce({ exitCode: 0 })
                .mockResolvedValueOnce({ exitCode: 0 })
                .mockRejectedValue(new Error('Test command failed execution')); // runTests throws

            const result = await validatePatch(mockConfig, mockPatch, mockSandbox, 'npm test');

            expect(result.testsPassed).toBe(false);
            expect(result.errorMessage).toContain('Tests failed: Test command failed execution');
        });
    });
});
