import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { writeFile, runCmd } from '../../services/sandbox/agent_tools';
import { validatePath, extractPaths } from '../../utils/pathDetection';
import { findUniqueFile } from '../../utils/fileVerification';

vi.mock('node:fs');
vi.mock('fs');
vi.mock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../utils/pathDetection', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validatePath: vi.fn(),
    extractPaths: vi.fn()
  };
});
vi.mock('../../utils/fileVerification', () => ({
    findUniqueFile: vi.fn()
}));
vi.mock('child_process', () => ({
    exec: vi.fn((cmd, options, cb) => cb(null, { stdout: 'success', stderr: '' }))
}));

describe('agent_tools Enhanced', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('writeFile', () => {
        it('should handle multiple candidates error', async () => {
            vi.mocked(validatePath).mockReturnValue({ valid: false, exists: false } as any);
            vi.mocked(findUniqueFile).mockResolvedValue({ found: false, matches: ['a.ts', 'b.ts'] } as any);
            vi.mocked(fs.readdirSync).mockReturnValue([] as any);

            const result = await writeFile('ambiguous.ts', 'content');
            expect(result).toContain('multiple candidates');
        });

        it('should strip markdown code blocks without newline', async () => {
            vi.mocked(validatePath).mockReturnValue({ valid: true, exists: true } as any);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
            
            const result = await writeFile('f.ts', '```ts\ncode```');
            expect(result).toContain('Successfully wrote');
        });
    });

    describe('runCmd', () => {
        it('should skip verification for creation commands', async () => {
            vi.mocked(extractPaths).mockReturnValue(['new_dir']);
            const result = await runCmd('mkdir new_dir');
            expect(result).toBe('success');
            expect(validatePath).not.toHaveBeenCalled();
        });

        it('should handle path corrections with quotes', async () => {
            vi.mocked(extractPaths).mockReturnValue(['old.ts']);
            vi.mocked(validatePath).mockReturnValue({ valid: false, exists: false } as any);
            vi.mocked(findUniqueFile).mockResolvedValue({ found: true, path: '/root/new.ts' } as any);
            
            const result = await runCmd('cat "old.ts"');
            expect(result).toBe('success');
        });

        it('should return error if multiple candidates found during runCmd', async () => {
            vi.mocked(extractPaths).mockReturnValue(['ambiguous.ts']);
            vi.mocked(validatePath).mockReturnValue({ valid: false, exists: false } as any);
            vi.mocked(findUniqueFile).mockResolvedValue({ found: false, matches: ['a.ts', 'b.ts'] } as any);
            vi.mocked(fs.readdirSync).mockReturnValue([] as any);

            const result = await runCmd('cat ambiguous.ts');
            expect(result).toContain('multiple candidates');
        });
    });
});
