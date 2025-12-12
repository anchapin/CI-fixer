import { describe, it, expect, vi, beforeEach } from 'vitest';
import { E2BSandbox } from '../../sandbox';

// Create a MockSandbox class structure that matches what we use
const mockFilesWrite = vi.fn();
const mockFilesRead = vi.fn();
const mockRunCode = vi.fn();
const mockKill = vi.fn();

const mockSandboxInstance = {
    sandboxId: 'test-sandbox-id',
    files: {
        write: mockFilesWrite,
        read: mockFilesRead
    },
    runCode: mockRunCode,
    kill: mockKill,
    connectionConfig: {
        getSandboxUrl: vi.fn((id: string, opts: any) => `https://test-${id}.e2b.dev`)
    }
};

// Mock the module
vi.mock('@e2b/code-interpreter', () => ({
    Sandbox: {
        create: vi.fn(() => Promise.resolve(mockSandboxInstance))
    }
}));

describe('E2BSandbox', () => {
    let sandbox: E2BSandbox;
    const apiKey = 'e2b_test_key';

    beforeEach(() => {
        vi.clearAllMocks();
        sandbox = new E2BSandbox(apiKey);
    });

    it('should initialize successfully', async () => {
        await sandbox.init();
        expect(sandbox.getId()).toBe('test-sandbox-id');
    });

    it('should teardown successfully', async () => {
        await sandbox.init();
        await sandbox.teardown();
        expect(mockKill).toHaveBeenCalled();
        expect(sandbox.getId()).toBe('unknown');
    });

    it('runCommand should execute code', async () => {
        await sandbox.init();
        mockRunCode.mockResolvedValueOnce({
            logs: { stdout: ['output'], stderr: [] },
            error: null
        });

        const res = await sandbox.runCommand('echo hello');
        expect(mockRunCode).toHaveBeenCalledWith('echo hello', { language: 'bash' });
        expect(res.stdout).toBe('output');
        expect(res.exitCode).toBe(0);
    });

    it('runCommand should handle errors', async () => {
        await sandbox.init();
        mockRunCode.mockResolvedValueOnce({
            logs: { stdout: [], stderr: ['error log'] },
            error: { value: 'Script Error' }
        });

        const res = await sandbox.runCommand('bad command');
        expect(res.stdout).toBe('');
        expect(res.stderr).toContain('error log');
        expect(res.stderr).toContain('Script Error');
        expect(res.exitCode).toBe(1);
    });

    it('writeFile should use sandbox.files.write', async () => {
        await sandbox.init();
        await sandbox.writeFile('test.txt', 'content');
        expect(mockFilesWrite).toHaveBeenCalledWith('test.txt', 'content');
    });

    it('readFile should use sandbox.files.read', async () => {
        await sandbox.init();
        mockFilesRead.mockResolvedValueOnce('file content');
        const content = await sandbox.readFile('test.txt');
        expect(mockFilesRead).toHaveBeenCalledWith('test.txt');
        expect(content).toBe('file content');
    });

    it('should throw if used before init', async () => {
        await expect(sandbox.runCommand('ls')).rejects.toThrow('Sandbox not initialized');
        await expect(sandbox.writeFile('a', 'b')).rejects.toThrow('Sandbox not initialized');
        await expect(sandbox.readFile('a')).rejects.toThrow('Sandbox not initialized');
    });
});
