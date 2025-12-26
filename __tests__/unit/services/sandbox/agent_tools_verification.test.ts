
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { readFile, writeFile, runCmd } from '../../../../services/sandbox/agent_tools.js';
import { findUniqueFile } from '../../../../utils/fileVerification.js';

// Mock findUniqueFile
vi.mock('../../../../utils/fileVerification.js', () => ({
    findUniqueFile: vi.fn()
}));

// Mock child_process exec and fs
const { mockExecPromise, mockExistsSync } = vi.hoisted(() => ({
    mockExecPromise: vi.fn(),
    mockExistsSync: vi.fn()
}));

vi.mock('fs', () => ({
    promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
    },
    existsSync: mockExistsSync,
    statSync: vi.fn(),
    default: {
        existsSync: mockExistsSync,
        statSync: vi.fn(),
        promises: {
            readFile: vi.fn(),
            writeFile: vi.fn(),
            mkdir: vi.fn(),
        }
    }
}));

vi.mock('child_process', () => ({
    exec: vi.fn()
}));

vi.mock('util', () => ({
    promisify: () => mockExecPromise
}));

describe('Agent Tools Verification & Auto-Recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: file does not exist
        mockExistsSync.mockReturnValue(false);
        (fs.statSync as any).mockReturnValue({ isFile: () => false });
    });

    describe('readFile with Auto-Recovery', () => {
        it('should auto-correct path when file is found elsewhere', async () => {
            const wrongPath = 'wrong/path/file.txt';
            const correctPath = path.resolve(process.cwd(), 'correct/path/file.txt');
            const content = 'recovered content';

            // Mock verification finding the file
            vi.mocked(findUniqueFile).mockResolvedValue({
                found: true,
                path: correctPath,
                matches: [correctPath]
            } as any);

            // Mock FS reading the CORRECT path
            (fs.promises.readFile as any).mockImplementation((p: string) => {
                if (p === correctPath) return Promise.resolve(content);
                return Promise.reject(new Error('File not found'));
            });

            const result = await readFile(wrongPath);

            expect(findUniqueFile).toHaveBeenCalledWith(wrongPath, expect.any(String));
            expect(result).toBe(content);
        });

        it('should return helpful error when multiple candidates found', async () => {
            const wrongPath = 'ambiguous.txt';
            
            vi.mocked(findUniqueFile).mockResolvedValue({
                found: false,
                matches: [
                    path.resolve('path/a/ambiguous.txt'),
                    path.resolve('path/b/ambiguous.txt')
                ]
            } as any);

            const result = await readFile(wrongPath);

            expect(result).toContain('multiple candidates were found');
            // Check for presence of the ambiguous file names, handling potential OS path separators
            expect(result.includes('ambiguous.txt')).toBe(true);
        });
    });

    describe('runCmd with Auto-Recovery', () => {
        it('should auto-correct path in "rm" command', async () => {
            const wrongPath = 'delete_me.txt';
            const correctPath = path.resolve(process.cwd(), 'real/delete_me.txt');

            vi.mocked(findUniqueFile).mockResolvedValue({
                found: true,
                path: correctPath,
                matches: [correctPath]
            } as any);

            mockExecPromise.mockResolvedValue({ stdout: '', stderr: '' });

            await runCmd(`rm ${wrongPath}`);

            // Expect the command to be executed with the CORRECTED path
            expect(mockExecPromise).toHaveBeenCalledWith(
                expect.stringContaining(correctPath), 
                expect.any(Object)
            );
        });

        it('should auto-correct source path in "mv" command', async () => {
            const wrongPath = 'old_name.txt';
            const target = 'new_name.txt';
            const correctPath = path.resolve(process.cwd(), 'src/old_name.txt');

            vi.mocked(findUniqueFile).mockResolvedValue({
                found: true,
                path: correctPath,
                matches: [correctPath]
            } as any);

            mockExecPromise.mockResolvedValue({ stdout: '', stderr: '' });

            await runCmd(`mv ${wrongPath} ${target}`);

            // Both paths are unique matches to src/old_name.txt in this mock setup
            expect(mockExecPromise).toHaveBeenCalledWith(
                expect.stringContaining(`${correctPath} ${correctPath}`), 
                expect.any(Object)
            );
        });

        it('should block command if multiple candidates found', async () => {
            const wrongPath = 'ambiguous.txt';
            
            vi.mocked(findUniqueFile).mockResolvedValue({
                found: false,
                matches: ['a/ambiguous.txt', 'b/ambiguous.txt']
            } as any);

            const result = await runCmd(`rm ${wrongPath}`);

            expect(result).toContain('multiple candidates were found');
            expect(mockExecPromise).not.toHaveBeenCalled();
        });
    });

    describe('writeFile with Auto-Recovery', () => {
        it('should write to existing file location if unique match found (updating instead of creating new)', async () => {
            const wrongPath = 'config.json';
            const correctPath = path.resolve(process.cwd(), 'src/config.json');

            vi.mocked(findUniqueFile).mockResolvedValue({
                found: true,
                path: correctPath,
                matches: [correctPath]
            } as any);

            (fs.promises.writeFile as any).mockResolvedValue(undefined);
            (fs.promises.mkdir as any).mockResolvedValue(undefined);

            await writeFile(wrongPath, '{}');

            expect(fs.promises.writeFile).toHaveBeenCalledWith(correctPath, '{}', 'utf-8');
        });
    });
});
