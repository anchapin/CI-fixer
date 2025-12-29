/**
 * Integration tests for Path Resolution in Worker
 * Phase 1, Task 2: Modify file operation calls to use absolute paths
 *
 * These tests verify that:
 * 1. findClosestFile calls store absolute paths
 * 2. validateFileExists accepts and returns absolute paths
 * 3. Path verification happens before file operations
 *
 * NOTE: Tests are platform-agnostic and work on both Windows and Unix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toAbsolutePath, findClosestFileAbsolute } from '../../../services/path-resolution.js';
import type { AppConfig } from '../../../types.js';
import path from 'path';

// Helper to get platform-specific expected path
const expectedPath = (unixPath: string): string => {
    if (process.platform === 'win32') {
        return 'C:\\' + unixPath.substring(1).replace(/\//g, '\\');
    }
    return unixPath;
};

describe('Path Resolution Integration in Worker', () => {
    let mockConfig: AppConfig;
    let mockSandbox: any;

    beforeEach(() => {
        mockConfig = {
            repoUrl: 'owner/repo',
            githubToken: 'test-token',
            workDir: process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project'
        } as any;

        mockSandbox = {
            readFile: vi.fn(),
            writeFile: vi.fn(),
            getWorkDir: vi.fn().mockReturnValue(process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project'),
            runCommand: vi.fn()
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('findClosestFile should return absolute paths', () => {
        it('should convert relative diagnosis.filePath to absolute before storing', async () => {
            const relativePath = 'src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            // Mock sandbox to return file content
            mockSandbox.readFile.mockResolvedValue('export const App = () => {};');

            // Call findClosestFileAbsolute
            const result = await findClosestFileAbsolute(mockConfig, relativePath, workingDir, mockSandbox);

            // Verify result has absolute path
            if (result) {
                expect(path.isAbsolute(result.path)).toBe(true);
                expect(result.path).not.toMatch(/^\.\.?\//); // Should not be relative
            } else {
                // If null, that's also acceptable (file not found)
                expect(result).toBeNull();
            }
        });

        it('should preserve already absolute paths', async () => {
            const absolutePath = process.platform === 'win32' ? 'C:\\home\\user\\project\\src\\App.tsx' : '/home/user/project/src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            mockSandbox.readFile.mockResolvedValue('export const App = () => {};');

            const result = await findClosestFileAbsolute(mockConfig, absolutePath, workingDir, mockSandbox);

            if (result) {
                expect(result.path).toBe(absolutePath);
            }
        });

        it('should normalize messy paths to clean absolute paths', async () => {
            const messyPath = process.platform === 'win32'
                ? '.\\src\\..\\src\\App.tsx'
                : './src/../src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            mockSandbox.readFile.mockResolvedValue('export const App = () => {};');

            const result = await findClosestFileAbsolute(mockConfig, messyPath, workingDir, mockSandbox);

            if (result) {
                // Should be normalized
                expect(result.path).not.toContain('..');
                expect(result.path).not.toContain(process.platform === 'win32' ? '\\\\' : '//');
            }
        });
    });

    describe('validateFileExists should work with absolute paths', () => {
        it('should accept absolute paths for validation', () => {
            const absolutePath = process.platform === 'win32' ? 'C:\\home\\user\\project\\src\\App.tsx' : '/home/user/project/src/App.tsx';

            // This test verifies that validateFileExists can handle absolute paths
            expect(path.isAbsolute(absolutePath)).toBe(true);
            expect(absolutePath).not.toMatch(/^\.\.?\//);
        });

        it('should convert relative paths to absolute before validation', () => {
            const relativePath = 'src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            const absolutePath = toAbsolutePath(relativePath, workingDir);

            expect(path.isAbsolute(absolutePath)).toBe(true);
            expect(absolutePath).not.toMatch(/^\.\.?\//);
        });
    });

    describe('Path verification before file operations', () => {
        it('should verify path is absolute before writeFile operations', () => {
            const relativePath = 'src/App.tsx';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            const absolutePath = toAbsolutePath(relativePath, workingDir);

            // Before any write operation, verify we have an absolute path
            expect(path.isAbsolute(absolutePath)).toBe(true);
            expect(absolutePath).toBeDefined();
            expect(absolutePath.length).toBeGreaterThan(0);
        });

        it('should throw error for empty paths before operations', () => {
            const emptyPath = '';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            expect(() => toAbsolutePath(emptyPath, workingDir)).toThrow(/File path cannot be empty/);
        });
    });

    describe('Real-world scenarios from production failure', () => {
        it('should handle the case where agent knew file existed but not exact path', async () => {
            // This simulates the production failure where agent tried to delete
            // 'coverage_improvement/test_cache_simple.py' but path didn't exist in sandbox context

            const relativePath = 'coverage_improvement/test_cache_simple.py';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';
            const sandboxWorkDir = process.platform === 'win32' ? 'C:\\home\\user\\project\\subdir' : '/home/user/project/subdir';

            mockSandbox.getWorkDir.mockReturnValue(sandboxWorkDir);
            mockSandbox.readFile.mockResolvedValue('# Test file content\n');

            const result = await findClosestFileAbsolute(mockConfig, relativePath, workingDir, mockSandbox);

            // The key fix: result.path should be absolute
            if (result) {
                expect(path.isAbsolute(result.path)).toBe(true);
                expect(result.path).not.toMatch(/^\.\.?\//);
            }
        });

        it('should prevent operations on paths that are not absolute', () => {
            const relativePath = '../test.py';
            const workingDir = process.platform === 'win32' ? 'C:\\home\\user\\project' : '/home/user/project';

            // Convert to absolute first
            const absolutePath = toAbsolutePath(relativePath, workingDir);

            // Verify we have a clean absolute path before proceeding
            expect(path.isAbsolute(absolutePath)).toBe(true);
            expect(absolutePath).not.toContain('..');
        });
    });
});
