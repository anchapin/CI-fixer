import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DockerSandbox, E2BSandbox, SimulationSandbox, createSandbox } from '../../sandbox';
import * as cp from 'child_process';
import * as fs from 'fs/promises';

vi.mock('child_process');
vi.mock('fs/promises');
vi.mock('node:fs/promises');

describe('DockerSandbox Enhanced', () => {
    let sandbox: DockerSandbox;

    beforeEach(() => {
        vi.clearAllMocks();
        sandbox = new DockerSandbox();
    });

    it('should throw if runCommand called before init', async () => {
        await expect(sandbox.runCommand('ls')).rejects.toThrow('Sandbox not initialized');
    });

    it('should handle init failure', async () => {
        // Mock loadModules implicitly by mocking cp.exec
        (cp.exec as any) = vi.fn((cmd, cb) => {
            cb(new Error('docker fail'), { stdout: '', stderr: 'error' });
        });
        await expect(sandbox.init()).rejects.toThrow('Failed to start Docker container');
    });

    it('should handle teardown when not initialized', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await sandbox.teardown();
        expect(cp.exec).not.toHaveBeenCalled();
    });

    it('should handle runCommand timeout', async () => {
        // Force load modules
        (cp.exec as any) = vi.fn((cmd, cb) => cb(null, { stdout: 'id', stderr: '' }));
        await sandbox.init();

        const mockProcess = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn(),
            kill: vi.fn()
        };
        (cp.spawn as any).mockReturnValue(mockProcess);

        // We need to trigger the timeout
        vi.useFakeTimers();
        const promise = sandbox.runCommand('sleep 10', { timeout: 1000 });
        vi.advanceTimersByTime(1000);
        
        const result = await promise;
        expect(result.exitCode).toBe(124);
        expect(result.stderr).toContain('Execution Timed Out');
        vi.useRealTimers();
    });

    it('should handle runCommand process error', async () => {
        (cp.exec as any) = vi.fn((cmd, cb) => cb(null, { stdout: 'id', stderr: '' }));
        await sandbox.init();

        const mockProcess: any = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: any) => {
                if (event === 'error') cb(new Error('spawn fail'));
            }),
            kill: vi.fn()
        };
        (cp.spawn as any).mockReturnValue(mockProcess);

        const result = await sandbox.runCommand('ls');
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe('spawn fail');
    });
});

describe('E2BSandbox Enhanced', () => {
    it('should throw if used before init', async () => {
        const sandbox = new E2BSandbox('api-key');
        await expect(sandbox.runCommand('ls')).rejects.toThrow('Sandbox not initialized');
        await expect(sandbox.writeFile('f.txt', 'c')).rejects.toThrow('Sandbox not initialized');
        await expect(sandbox.readFile('f.txt')).rejects.toThrow('Sandbox not initialized');
        await expect(sandbox.listFiles()).rejects.toThrow('Sandbox not initialized');
    });
});

describe('SimulationSandbox', () => {
    it('should support basic operations', async () => {
        const sandbox = new SimulationSandbox();
        await sandbox.init();
        expect(await sandbox.readFile('any')).toContain('[SIMULATION]');
        expect(await sandbox.runCommand('ls')).toBeDefined();
        const files = await sandbox.listFiles();
        expect(files.size).toBeGreaterThan(0);
        await sandbox.teardown();
    });
});

describe('createSandbox factory', () => {
    it('should create DockerSandbox when configured', () => {
        const config = { executionBackend: 'docker_local' };
        const sb = createSandbox(config as any);
        expect(sb).toBeInstanceOf(DockerSandbox);
    });

    it('should create E2BSandbox when configured', () => {
        const config = { devEnv: 'e2b', e2bApiKey: 'key' };
        const sb = createSandbox(config as any);
        expect(sb).toBeInstanceOf(E2BSandbox);
    });

    it('should default to SimulationSandbox', () => {
        const sb = createSandbox({} as any);
        expect(sb).toBeInstanceOf(SimulationSandbox);
    });
});
