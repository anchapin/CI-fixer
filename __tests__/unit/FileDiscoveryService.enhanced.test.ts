import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileDiscoveryService } from '../../services/sandbox/FileDiscoveryService';
import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'tinyglobby';

vi.mock('node:fs');
vi.mock('tinyglobby');

describe('FileDiscoveryService Enhanced', () => {
    let service: FileDiscoveryService;
    let sandbox: SandboxEnvironment;
    let config: AppConfig;
    const rootDir = '/root';

    beforeEach(() => {
        vi.clearAllMocks();
        service = new FileDiscoveryService();
        sandbox = {
            runCommand: vi.fn(),
        } as any;
        config = {} as any;
    });

    describe('findUniqueFile', () => {
        it('should handle absolute paths', async () => {
            const absPath = path.resolve(rootDir, 'test.txt');
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);

            const result = await service.findUniqueFile(absPath, rootDir);
            expect(result.found).toBe(true);
            expect(result.path).toBe(absPath);
        });

        it('should ignore if it is a directory', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any);
            vi.mocked(glob).mockResolvedValue([]);

            const result = await service.findUniqueFile('dir', rootDir);
            expect(result.found).toBe(false);
        });

        it('should handle multiple glob matches', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(glob).mockResolvedValue(['/root/src/a.ts', '/root/tests/a.ts']);

            const result = await service.findUniqueFile('a.ts', rootDir);
            expect(result.found).toBe(false);
            expect(result.matches).toHaveLength(2);
        });

        it('should calculate depth correctly for root and nested files', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);

            const resultRoot = await service.findUniqueFile('root.txt', rootDir);
            expect(resultRoot.depth).toBe(1);

            // Mock nested file
            vi.mocked(fs.existsSync).mockReturnValue(false);
            vi.mocked(glob).mockResolvedValue([path.normalize('/root/src/inner/file.ts')]);
            const resultNested = await service.findUniqueFile('file.ts', rootDir);
            expect(resultNested.depth).toBe(3);
        });
    });

    describe('recursiveSearch error paths', () => {
        it('should return null if exit code is non-zero', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: '',
                stderr: 'error',
                exitCode: 1
            });
            const result = await service.recursiveSearch(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });

        it('should return null if stdout is empty', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: '  ',
                stderr: '',
                exitCode: 0
            });
            const result = await service.recursiveSearch(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });

        it('should handle exceptions in sandbox.runCommand', async () => {
            vi.mocked(sandbox.runCommand).mockRejectedValue(new Error('crash'));
            const result = await service.recursiveSearch(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });
    });

    describe('fuzzySearch error paths', () => {
        it('should return null if find command fails', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: '',
                stderr: 'error',
                exitCode: 1
            });
            const result = await service.fuzzySearch(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });

        it('should fallback to simple includes when no fuzzy matches found with Fuse', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: './src/my_long_filename.txt\n',
                stderr: '',
                exitCode: 0
            });
            // fuse.search will be empty because threshold 0.6 might be too strict for this if it's not a good match
            // but we can just mock fuse if we wanted to be precise. 
            // Actually fuse is not mocked, so it will run real logic.
            // Let's use a query that definitely fails fuse but passes simple includes.
            const result = await service.fuzzySearch(config, 'long_filename', sandbox);
            expect(result).toBe('./src/my_long_filename.txt');
        });

        it('should handle exceptions', async () => {
            vi.mocked(sandbox.runCommand).mockRejectedValue(new Error('crash'));
            const result = await service.fuzzySearch(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });
    });

    describe('checkGitHistoryForRename error paths', () => {
        it('should return null if git command fails', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: '',
                stderr: 'error',
                exitCode: 1
            });
            const result = await service.checkGitHistoryForRename(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });

        it('should handle non-rename lines in git output', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: 'M\tfile.txt\n',
                stderr: '',
                exitCode: 0
            });
            const result = await service.checkGitHistoryForRename(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });

        it('should handle exceptions', async () => {
            vi.mocked(sandbox.runCommand).mockRejectedValue(new Error('crash'));
            const result = await service.checkGitHistoryForRename(config, 'file.txt', sandbox);
            expect(result).toBeNull();
        });
    });

    describe('checkGitHistoryForDeletion error paths', () => {
        it('should return false if git command fails', async () => {
            vi.mocked(sandbox.runCommand).mockResolvedValue({
                stdout: '',
                stderr: 'error',
                exitCode: 1
            });
            const result = await service.checkGitHistoryForDeletion(config, 'file.txt', sandbox);
            expect(result).toBe(false);
        });

        it('should handle exceptions', async () => {
            vi.mocked(sandbox.runCommand).mockRejectedValue(new Error('crash'));
            const result = await service.checkGitHistoryForDeletion(config, 'file.txt', sandbox);
            expect(result).toBe(false);
        });
    });
});
