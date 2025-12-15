
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { readFile, writeFile, runCmd, search, listDir } from '../../../../services/sandbox/agent_tools.js';

// Mock fs.promises
vi.mock('fs', () => ({
    promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
    }
}));

// Mock child_process exec
const { mockExecPromise } = vi.hoisted(() => ({
    mockExecPromise: vi.fn()
}));

vi.mock('child_process', () => ({
    exec: vi.fn()
}));

// Mock util.promisify
vi.mock('util', async () => {
    return {
        promisify: (fn: any) => mockExecPromise
    };
});


describe('Agent Tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('readFile', () => {
        it('should read file content successfully', async () => {
            (fs.promises.readFile as any).mockResolvedValue('file content');
            const result = await readFile('test.txt');
            expect(result).toBe('file content');
            expect(fs.promises.readFile).toHaveBeenCalled();
        });

        it('should return error message on failure', async () => {
            (fs.promises.readFile as any).mockRejectedValue(new Error('Read failed'));
            const result = await readFile('missing.txt');
            expect(result).toContain('Error reading file');
            expect(result).toContain('Read failed');
        });
    });

    describe('writeFile', () => {
        it('should write file content successfully', async () => {
            (fs.promises.mkdir as any).mockResolvedValue(undefined);
            (fs.promises.writeFile as any).mockResolvedValue(undefined);

            const result = await writeFile('dir/test.txt', 'content');

            expect(result).toContain('Successfully wrote');
            expect(fs.promises.mkdir).toHaveBeenCalled(); // recursive true
            expect(fs.promises.writeFile).toHaveBeenCalledWith(expect.stringContaining('test.txt'), 'content', 'utf-8');
        });

        it('should return error message on failure', async () => {
            (fs.promises.mkdir as any).mockRejectedValue(new Error('Write failed'));
            const result = await writeFile('test.txt', 'content');
            expect(result).toContain('Error writing to file');
        });
    });

    describe('runCmd', () => {
        it('should execute command and return stdout', async () => {
            mockExecPromise.mockResolvedValue({ stdout: 'command output', stderr: '' });
            const result = await runCmd('ls');
            expect(result).toBe('command output');
            expect(mockExecPromise).toHaveBeenCalledWith('ls', expect.any(Object));
        });

        it('should include stderr if present', async () => {
            mockExecPromise.mockResolvedValue({ stdout: 'out', stderr: 'warning' });
            const result = await runCmd('ls');
            expect(result).toContain('out');
            expect(result).toContain('[STDERR]');
            expect(result).toContain('warning');
        });

        it('should handle execution errors', async () => {
            const error: any = new Error('Command failed');
            error.stdout = 'partial out';
            error.stderr = 'fatal error';
            mockExecPromise.mockRejectedValue(error);

            const result = await runCmd('bad-cmd');
            expect(result).toContain('Error executing command');
            expect(result).toContain('Command failed');
            expect(result).toContain('partial out');
            expect(result).toContain('[STDERR]');
            expect(result).toContain('fatal error');
        });
    });

    describe('search', () => {
        it('should parse grep output correctly', async () => {
            // Mock runCmd indirectly via mockExecPromise
            const grepOutput = `file1.ts:match1\nfile1.ts:match2\nfile2.ts:match3`;
            mockExecPromise.mockResolvedValue({ stdout: grepOutput, stderr: '' });

            const results = await search('query');

            expect(results).toHaveLength(2);
            expect(results).toContain('file1.ts');
            expect(results).toContain('file2.ts');
            // Mock check
            expect(mockExecPromise).toHaveBeenCalledWith(expect.stringContaining('grep'), expect.any(Object));
        });

        it('should return empty array on command failure', async () => {
            mockExecPromise.mockRejectedValue(new Error('Grep failed'));
            const results = await search('query');
            expect(results).toEqual([]);
        });
    });

    describe('listDir', () => {
        it('should list files in directory', async () => {
            (fs.promises.readdir as any).mockResolvedValue(['file1', 'file2']);
            const results = await listDir('.');
            expect(results).toEqual(['file1', 'file2']);
        });

        it('should return error entry on failure', async () => {
            (fs.promises.readdir as any).mockRejectedValue(new Error('Access denied'));
            const results = await listDir('.');
            expect(results[0]).toContain('Error listing directory');
        });
    });
});
