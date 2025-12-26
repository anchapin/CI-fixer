import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSandboxTest } from '../../../../services/analysis/LogAnalysisService';
import { BunErrorPattern } from '../../../../services/analysis/BunErrorPattern';

describe('AdaptiveExecution', () => {
    let mockSandbox: any;
    let commandHistory: { cmd: string, output: string, exitCode: number }[];

    beforeEach(() => {
        vi.resetAllMocks();
        commandHistory = [];

        mockSandbox = {
            writeFile: vi.fn(),
            runCommand: vi.fn().mockImplementation(async (cmd: string) => {
                let output = 'Success';
                let exitCode = 0;

                // Simulate Node failure on Bun project
                if (cmd.includes('vitest') || cmd.includes('npm test')) {
                    output = 'Error: Cannot bundle built-in module "bun:test"';
                    exitCode = 1;
                }

                if (cmd.includes('bun test')) {
                    output = 'Bun Tests Passed';
                    exitCode = 0;
                }

                commandHistory.push({ cmd, output, exitCode });
                return { stdout: output, stderr: '', exitCode };
            })
        };
    });

    it('should retry with "bun test" if vitest fails with Bun-specific error', async () => {
        const result = await runSandboxTest(
            { checkEnv: 'e2b' } as any,
            { mainRun: {} } as any,
            1,
            false,
            { path: 'src/file.ts', modified: { content: 'import "bun:test";' } } as any,
            'fix error',
            vi.fn(), // logCallback
            {},
            mockSandbox,
            'npx vitest run src/file.ts' // explicit test command
        );

        expect(result.passed).toBe(true);
        expect(result.logs).toContain('Bun Tests Passed');
        
        // Should have at least two commands: vitest then bun test
        const cmds = commandHistory.map(h => h.cmd);
        expect(cmds).toContain('npx vitest run src/file.ts');
        expect(cmds.some(c => c.includes('bun test'))).toBe(true);
    });
});
