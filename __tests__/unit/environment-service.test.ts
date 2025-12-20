import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvironmentService } from '../../services/sandbox/EnvironmentService';
import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';

describe('EnvironmentService', () => {
    let service: EnvironmentService;
    let sandbox: SandboxEnvironment;
    let config: AppConfig;

    beforeEach(() => {
        service = new EnvironmentService();
        sandbox = {
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
        } as any;
        config = {} as any;
    });

    it('should refresh dependencies using pnpm', async () => {
        await service.refreshDependencies(config, sandbox);
        expect(sandbox.runCommand).toHaveBeenCalledWith('pnpm install --no-frozen-lockfile');
    });

    it('should purge environment', async () => {
        await service.purgeEnvironment(config, sandbox);
        expect(sandbox.runCommand).toHaveBeenCalledWith('rm -rf node_modules');
        expect(sandbox.runCommand).toHaveBeenCalledWith('pnpm store prune');
    });

    it('should repair patches', async () => {
        await service.repairPatches(config, sandbox);
        expect(sandbox.runCommand).toHaveBeenCalledWith('npx patch-package');
    });

    it('should kill dangling processes', async () => {
        await service.killDanglingProcesses(config, sandbox);
        expect(sandbox.runCommand).toHaveBeenCalledWith('pkill -f node || true');
        expect(sandbox.runCommand).toHaveBeenCalledWith('pkill -f jest || true');
        expect(sandbox.runCommand).toHaveBeenCalledWith('pkill -f vitest || true');
        expect(sandbox.runCommand).toHaveBeenCalledWith('pkill -f playwright || true');
    });
});
