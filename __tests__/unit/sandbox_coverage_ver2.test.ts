import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerSandbox } from '../../sandbox';

// Mocks
const mockExec = vi.fn();
const mockSpawn = vi.fn();
const mockAccess = vi.fn();
const mockWriteFile = vi.fn();
const mockUnlink = vi.fn();

vi.mock('child_process', () => ({
    exec: (cmd: string, cb: any) => {
        mockExec(cmd).then((res: any) => cb(null, res)).catch((err: any) => cb(err, null));
        return {} as any;
    },
    spawn: (...args: any[]) => mockSpawn(...args)
}));

vi.mock('util', () => ({
    promisify: (fn: any) => mockExec
}));

vi.mock('fs/promises', () => ({
    access: (...args: any[]) => mockAccess(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    unlink: (...args: any[]) => mockUnlink(...args)
}));

describe('DockerSandbox Verification', () => {
    let sandbox: DockerSandbox;

    beforeEach(() => {
        vi.clearAllMocks();
        mockExec.mockReset();
        mockSpawn.mockReset();

        sandbox = new DockerSandbox('test-image');
    });

    it('should initialize and load modules', async () => {
        mockExec.mockResolvedValue({ stdout: 'container-id\n', stderr: '' });
        await sandbox.init();
        expect(sandbox.getId()).toBe('container-id');
    });

    it('should handle init failure', async () => {
        mockExec.mockRejectedValue(new Error('Docker failed'));
        await expect(sandbox.init()).rejects.toThrow('Failed to start Docker container');
    });

    it('should teardown successfully', async () => {
        mockExec.mockResolvedValueOnce({ stdout: 'id', stderr: '' });
        await sandbox.init();

        mockExec.mockResolvedValueOnce({ stdout: '', stderr: '' });
        await sandbox.teardown();

        expect(mockExec).toHaveBeenLastCalledWith(expect.stringContaining('docker stop'));
        expect(sandbox.getId()).toBe('unknown');
    });

    it('runCommand should throw if not initialized', async () => {
        await expect(sandbox.runCommand('ls')).rejects.toThrow('Sandbox not initialized');
    });

    it('runCommand should execute via spawn', async () => {
        mockExec.mockResolvedValue({ stdout: 'id', stderr: '' });
        await sandbox.init();

        const mockStdoutOn = vi.fn();
        const mockOn = vi.fn();
        const mockChild = {
            stdout: { on: mockStdoutOn },
            stderr: { on: vi.fn() },
            on: mockOn,
        };
        mockSpawn.mockReturnValue(mockChild);

        const runPromise = sandbox.runCommand('echo hello');
        await new Promise(r => setTimeout(r, 0));

        const stdoutCall = mockStdoutOn.mock.calls.find(c => c[0] === 'data');
        if (stdoutCall) stdoutCall[1](Buffer.from('hello output'));

        const closeCall = mockOn.mock.calls.find(c => c[0] === 'close');
        if (closeCall) closeCall[1](0);

        const res = await runPromise;
        expect(res.stdout).toBe('hello output');
    });

    it('writeFile should create parent directories if needed', async () => {
        mockExec.mockResolvedValue({ stdout: 'id', stderr: '' });
        await sandbox.init();

        const runCommandSpy = vi.spyOn(sandbox, 'runCommand').mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        mockExec.mockResolvedValue({ stdout: '', stderr: '' }); // for docker cp

        await sandbox.writeFile('deep/nested/file.txt', 'content');

        expect(runCommandSpy).toHaveBeenCalledWith(expect.stringContaining('mkdir -p'));
    });

    it('readFile should use cat', async () => {
        mockExec.mockResolvedValue({ stdout: 'id', stderr: '' });
        await sandbox.init();

        const runCommandSpy = vi.spyOn(sandbox, 'runCommand').mockResolvedValue({ stdout: 'file content', stderr: '', exitCode: 0 });

        const content = await sandbox.readFile('test.txt');
        expect(content).toBe('file content');
    });
});
