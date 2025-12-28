import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BunDetector } from '../../../../services/analysis/BunDetector';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('BunDetector Enhanced', () => {
    const mockProjectRoot = '/mock/project';

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('detectBunLock', () => {
        it('should rethrow non-ENOENT errors', async () => {
            const error = new Error('Permission denied');
            (error as any).code = 'EACCES';
            (fs.stat as any).mockRejectedValue(error);
            
            await expect(BunDetector.detectBunLock(mockProjectRoot)).rejects.toThrow('Permission denied');
        });
    });

    describe('detectBunConfig', () => {
        it('should rethrow non-ENOENT errors', async () => {
            const error = new Error('Permission denied');
            (error as any).code = 'EACCES';
            (fs.stat as any).mockRejectedValue(error);
            
            await expect(BunDetector.detectBunConfig(mockProjectRoot)).rejects.toThrow('Permission denied');
        });
    });

    describe('scanForBunImports', () => {
        it('should return false if depth exceeds maxDepth', async () => {
            const result = await BunDetector.scanForBunImports(mockProjectRoot, 6, 5);
            expect(result).toBe(false);
        });

        it('should skip ignored directories', async () => {
            (fs.readdir as any).mockResolvedValue([
                { name: 'node_modules', isDirectory: () => true, isFile: () => false },
                { name: 'src', isDirectory: () => true, isFile: () => false }
            ]);
            
            // Mock second call for 'src'
            (fs.readdir as any).mockResolvedValueOnce([
                { name: 'node_modules', isDirectory: () => true, isFile: () => false },
                { name: 'src', isDirectory: () => true, isFile: () => false }
            ]).mockResolvedValueOnce([]); // for 'src'

            const result = await BunDetector.scanForBunImports(mockProjectRoot);
            expect(result).toBe(false);
            // Verify readdir was called for 'src' but not 'node_modules'
            expect(fs.readdir).toHaveBeenCalledWith(path.join(mockProjectRoot, 'src'), expect.anything());
            expect(fs.readdir).not.toHaveBeenCalledWith(path.join(mockProjectRoot, 'node_modules'), expect.anything());
        });

        it('should skip files with non-matching extensions', async () => {
            (fs.readdir as any).mockResolvedValue([
                { name: 'image.png', isDirectory: () => false, isFile: () => true }
            ]);
            
            const result = await BunDetector.scanForBunImports(mockProjectRoot);
            expect(result).toBe(false);
            expect(fs.readFile).not.toHaveBeenCalled();
        });

        it('should detect imports with single quotes', async () => {
            (fs.readdir as any).mockResolvedValue([
                { name: 'app.js', isDirectory: () => false, isFile: () => true }
            ]);
            (fs.readFile as any).mockResolvedValue("import { test } from 'bun:test';");
            
            const result = await BunDetector.scanForBunImports(mockProjectRoot);
            expect(result).toBe(true);
        });

        it('should handle readdir failure gracefully', async () => {
            (fs.readdir as any).mockRejectedValue(new Error('Access denied'));
            const result = await BunDetector.scanForBunImports(mockProjectRoot);
            expect(result).toBe(false);
        });
    });
});
