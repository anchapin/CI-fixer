
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findUniqueFile } from '../../utils/fileVerification';
import * as fs from 'node:fs';
import { glob } from 'tinyglobby';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

vi.mock('node:fs');
vi.mock('tinyglobby');
vi.mock('node:child_process');

describe('findUniqueFile', () => {
    const mockCwd = '/test/project';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(execSync).mockReturnValue('' as any);
    });

    it('should return found: true when file exists exactly', async () => {
        const filePath = 'src/existing.ts';
        const absolutePath = path.resolve(mockCwd, filePath);

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);

        const result = await findUniqueFile(filePath, mockCwd);

        expect(result).toEqual({
            found: true,
            path: absolutePath,
            matches: [absolutePath]
        });
        expect(fs.existsSync).toHaveBeenCalledWith(absolutePath);
    });

    it('should search project-wide when file does not exist', async () => {
        const filePath = 'src/missing.ts';
        const absolutePath = path.resolve(mockCwd, filePath);

        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(glob).mockResolvedValue([absolutePath]);

        const result = await findUniqueFile(filePath, mockCwd);

        expect(glob).toHaveBeenCalledWith('**/missing.ts', expect.objectContaining({
            cwd: mockCwd,
            absolute: true
        }));
        expect(result).toEqual({
            found: true,
            path: absolutePath,
            matches: [absolutePath]
        });
    });

    it('should return found: false when multiple matches are found', async () => {
        const filePath = 'Button.tsx';
        const match1 = path.resolve(mockCwd, 'src/components/Button.tsx');
        const match2 = path.resolve(mockCwd, 'src/admin/components/Button.tsx');

        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(glob).mockResolvedValue([match1, match2]);

        const result = await findUniqueFile(filePath, mockCwd);

        expect(result).toEqual({
            found: false,
            matches: [match1, match2]
        });
    });

    it('should return found: false when no matches are found', async () => {
        const filePath = 'ghost.ts';

        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(glob).mockResolvedValue([]);

        const result = await findUniqueFile(filePath, mockCwd);

        expect(result).toEqual({
            found: false,
            matches: []
        });
    });

    it('should ignore directories if path exists but is not a file', async () => {
        const dirPath = 'src/components';
        const absolutePath = path.resolve(mockCwd, dirPath);

        // First check says it exists
        vi.mocked(fs.existsSync).mockReturnValueOnce(true);
        // But it is a directory
        vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any);
        
        // Glob fallback finds nothing (simulated)
        vi.mocked(glob).mockResolvedValue([]);

        const result = await findUniqueFile(dirPath, mockCwd);
        
        expect(fs.statSync).toHaveBeenCalledWith(absolutePath);
        // Should fall through to glob search
        expect(glob).toHaveBeenCalled();
        expect(result.found).toBe(false);
    });
});
