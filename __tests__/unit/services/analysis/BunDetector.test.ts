import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BunDetector } from '../../../../services/analysis/BunDetector';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('BunDetector', () => {
    const mockProjectRoot = '/mock/project';

    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('detectBunLock', () => {
        it('should return true if bun.lockb exists', async () => {
            (fs.stat as any).mockResolvedValue({ isFile: () => true });
            
            const result = await BunDetector.detectBunLock(mockProjectRoot);
            expect(result).toBe(true);
            expect(fs.stat).toHaveBeenCalledWith(path.join(mockProjectRoot, 'bun.lockb'));
        });

        it('should return false if bun.lockb does not exist', async () => {
            (fs.stat as any).mockRejectedValue({ code: 'ENOENT' });
            
            const result = await BunDetector.detectBunLock(mockProjectRoot);
            expect(result).toBe(false);
        });
    });

    describe('detectBunConfig', () => {
        it('should return true if bunfig.toml exists', async () => {
            (fs.stat as any).mockResolvedValue({ isFile: () => true });
            
            const result = await BunDetector.detectBunConfig(mockProjectRoot);
            expect(result).toBe(true);
            expect(fs.stat).toHaveBeenCalledWith(path.join(mockProjectRoot, 'bunfig.toml'));
        });

        it('should return false if bunfig.toml does not exist', async () => {
            (fs.stat as any).mockRejectedValue({ code: 'ENOENT' });
            
            const result = await BunDetector.detectBunConfig(mockProjectRoot);
            expect(result).toBe(false);
        });
    });

    describe('scanForBunImports', () => {
        it('should detect "bun:test" imports in files', async () => {
            const mockFiles = ['test.ts', 'index.ts'];
            const mockContent = `import { test } from "bun:test";`;

            // Mock readdir to return files
            (fs.readdir as any).mockResolvedValue(mockFiles.map(f => ({ name: f, isDirectory: () => false, isFile: () => true })));
            // Mock readFile to return content
            (fs.readFile as any).mockImplementation((filePath: string) => {
                if (filePath.endsWith('test.ts')) return Promise.resolve(mockContent);
                return Promise.resolve('');
            });
            // Mock stat for recursive search (simplified here, assuming flat for test)
            (fs.stat as any).mockResolvedValue({ isDirectory: () => false });

            const result = await BunDetector.scanForBunImports(mockProjectRoot);
            expect(result).toBe(true);
        });

        it('should return false if no bun imports are found', async () => {
             const mockFiles = ['test.ts'];
            const mockContent = `import { test } from "vitest";`;

            (fs.readdir as any).mockResolvedValue(mockFiles.map(f => ({ name: f, isDirectory: () => false, isFile: () => true })));
            (fs.readFile as any).mockResolvedValue(mockContent);
            (fs.stat as any).mockResolvedValue({ isDirectory: () => false });

            const result = await BunDetector.scanForBunImports(mockProjectRoot);
            expect(result).toBe(false);
        });
    });

    describe('isBunProject', () => {
        it('should return true if bun.lockb exists', async () => {
            (fs.stat as any).mockImplementation((p: string) => {
                if (p.endsWith('bun.lockb')) return Promise.resolve({ isFile: () => true });
                return Promise.reject({ code: 'ENOENT' });
            });
            
            const result = await BunDetector.isBunProject(mockProjectRoot);
            expect(result).toBe(true);
        });

        it('should return true if bun imports are found even without lockfile', async () => {
            // No lockfile
            (fs.stat as any).mockRejectedValue({ code: 'ENOENT' });
            // But mock readdir/readFile for imports
            (fs.readdir as any).mockResolvedValue([{ name: 'test.ts', isDirectory: () => false, isFile: () => true }]);
            (fs.readFile as any).mockResolvedValue(`import { test } from "bun:test";`);

            const result = await BunDetector.isBunProject(mockProjectRoot);
            expect(result).toBe(true);
        });
    });
});
