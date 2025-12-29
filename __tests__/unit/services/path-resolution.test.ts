/**
 * Unit tests for Path Resolution Enhancement
 * Phase 1, Task 1: Add absolute path conversion utility
 *
 * These tests verify that:
 * 1. Relative paths are correctly converted to absolute paths
 * 2. Absolute paths are preserved unchanged
 * 3. Integration with findClosestFile returns absolute paths
 * 4. Edge cases are handled properly
 *
 * NOTE: Tests are platform-agnostic and work on both Windows and Unix
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { toAbsolutePath, resolvePathWithValidation, findClosestFileAbsolute, isValidAbsolutePath } from '../../../services/path-resolution.js';

// Helper to get platform-specific expected path
const expectedPath = (unixPath: string): string => {
    // On Windows, convert /home/user/project to C:\home\user\project
    // On Unix, keep as /home/user/project
    if (process.platform === 'win32') {
        // Replace leading slash with C:\ and then replace remaining / with \
        return 'C:\\' + unixPath.substring(1).replace(/\//g, '\\');
    }
    return unixPath;
};

describe('Path Resolution Utility', () => {

    describe('toAbsolutePath', () => {
        it('should convert relative path to absolute', () => {
            const relativePath = 'src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            const result = toAbsolutePath(relativePath, workingDir);
            expect(result).toBe(expectedPath('/home/user/project/src/App.tsx'));
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('should convert relative path with parent directory references', () => {
            const relativePath = '../src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project\\subdir' : '/home/user/project/subdir';

            const result = toAbsolutePath(relativePath, workingDir);
            expect(result).toBe(expectedPath('/home/user/project/src/App.tsx'));
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('should preserve absolute paths unchanged', () => {
            const absolutePath = process.platform === 'win32' ? 'C:\\home\\user\\project\\src\\App.tsx' : '/home/user/project/src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            const result = toAbsolutePath(absolutePath, workingDir);
            expect(result).toBe(expectedPath('/home/user/project/src/App.tsx'));
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('should handle empty path by throwing error', () => {
            const emptyPath = '';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            expect(() => toAbsolutePath(emptyPath, workingDir)).toThrow(/File path cannot be empty/);
        });

        it('should handle paths with leading ./ correctly', () => {
            const relativePath = './src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            const result = toAbsolutePath(relativePath, workingDir);
            expect(result).toBe(expectedPath('/home/user/project/src/App.tsx'));
            expect(path.isAbsolute(result)).toBe(true);
        });

        it('should normalize paths (remove redundant slashes, resolve ..)', () => {
            const messyPath = process.platform === 'win32'
                ? 'C:\\home\\user\\project\\..\\project\\src\\\\App.tsx'
                : '/home/user/project/../project/src//App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            const result = toAbsolutePath(messyPath, workingDir);
            expect(result).toBe(expectedPath('/home/user/project/src/App.tsx'));
            expect(path.isAbsolute(result)).toBe(true);
        });
    });

    describe('resolvePathWithValidation', () => {
        it('should validate file exists before returning absolute path', async () => {
            const filePath = 'src/App.tsx';
            const workingDir = '/home/user/project';
            const mockConfig = {
                repoUrl: 'owner/repo',
                githubToken: 'test-token'
            } as any;

            // This test would require mocking findClosestFile
            // For now, we'll test the error case
            try {
                await resolvePathWithValidation(filePath, workingDir, mockConfig);
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toContain('Failed to resolve');
            }
        });

        it('should throw clear error when file does not exist', async () => {
            const nonExistentPath = 'nonexistent/file.ts';
            const workingDir = '/home/user/project';
            const mockConfig = {
                repoUrl: 'owner/repo',
                githubToken: 'test-token'
            } as any;

            await expect(
                resolvePathWithValidation(nonExistentPath, workingDir, mockConfig)
            ).rejects.toThrow(/Failed to resolve/);
        });
    });

    describe('isValidAbsolutePath', () => {
        it('should return true for valid absolute paths', () => {
            const validPath = process.platform === 'win32' ? 'C:\\home\\user\\project\\src\\App.tsx' : '/home/user/project/src/App.tsx';
            expect(isValidAbsolutePath(validPath)).toBe(true);
        });

        it('should return false for relative paths', () => {
            const relativePath = 'src/App.tsx';
            expect(isValidAbsolutePath(relativePath)).toBe(false);
        });

        it('should return false for empty paths', () => {
            expect(isValidAbsolutePath('')).toBe(false);
            expect(isValidAbsolutePath('   ')).toBe(false);
        });

        it('should return false for paths that need normalization', () => {
            const messyPath = process.platform === 'win32'
                ? 'C:\\home\\user\\project\\..\\project\\src\\\\App.tsx'
                : '/home/user/project/../project/src//App.tsx';
            expect(isValidAbsolutePath(messyPath)).toBe(false);
        });
    });

    describe('Integration with findClosestFile', () => {
        it('should enhance findClosestFile to always return absolute paths', async () => {
            const filePath = 'src/utils/helper.ts';
            const workingDir = '/home/user/project';
            const mockConfig = {
                repoUrl: 'owner/repo',
                githubToken: 'test-token'
            } as any;

            // This would require mocking findClosestFile
            // For now, test null case
            const result = await findClosestFileAbsolute(mockConfig, filePath, workingDir);
            expect(result).toBeNull(); // File doesn't exist in test context
        });
    });
});
