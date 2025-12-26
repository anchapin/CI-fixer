import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCmd } from '../../services/sandbox/agent_tools';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'tinyglobby';

vi.mock('node:child_process', () => ({
    exec: vi.fn(),
    execSync: vi.fn()
}));
vi.mock('node:fs');
vi.mock('tinyglobby');

describe('runCmd (Enhanced Integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default exec mock
        (child_process.exec as any).mockImplementation((cmd, options, callback) => {
            if (typeof options === 'function') {
                options(null, { stdout: 'mock output', stderr: '' });
            } else {
                callback(null, { stdout: 'mock output', stderr: '' });
            }
        });
        // Default execSync mock for fuzzy search
        (child_process.execSync as any).mockReturnValue('');
    });

    it('should intercept cat command with non-existent path and auto-recover', async () => {
        const cmd = 'cat src/index.js';
        
        // Mock fs.existsSync to fail for the specific path
        vi.mocked(fs.existsSync).mockReturnValue(false);
        
        // Mock glob to return a single match elsewhere
        const absPath = path.resolve('/abs/path/to/src/index.ts');
        vi.mocked(glob).mockResolvedValue([absPath]);
        vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);

        const output = await runCmd(cmd);

        // Should have corrected the path in the command before execution
        // The implementation uses absolute path for replacement currently
        expect(child_process.exec).toHaveBeenCalledWith(
            expect.stringContaining(absPath),
            expect.any(Object),
            expect.any(Function)
        );
    });

    it('should block execution and return error if multiple candidates are found for cat', async () => {
        const cmd = 'cat utils.ts';
        
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(glob).mockResolvedValue([
            '/abs/path/src/utils.ts',
            '/abs/path/tests/utils.ts'
        ]);

        const output = await runCmd(cmd);

        expect(output).toContain('multiple candidates were found');
        expect(child_process.exec).not.toHaveBeenCalled();
    });
});
