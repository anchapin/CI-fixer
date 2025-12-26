import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvironmentService } from '../../../../services/sandbox/EnvironmentService';

describe('EnvironmentServiceBun', () => {
    let mockSandbox: any;
    let commandHistory: string[];

    beforeEach(() => {
        vi.resetAllMocks();
        commandHistory = [];

        mockSandbox = {
            getWorkDir: () => '/mock/work/dir',
            runCommand: vi.fn().mockImplementation(async (cmd: string) => {
                commandHistory.push(cmd);
                if (cmd.startsWith('ls ')) {
                    if (cmd.includes('bun.lockb')) return { stdout: 'bun.lockb', exitCode: 0 };
                    return { stdout: 'package.json', exitCode: 0 };
                }
                return { stdout: '', exitCode: 0 };
            })
        };
    });

    it('should use bun install if bun.lockb is present', async () => {
        const service = new EnvironmentService();
        await service.refreshDependencies({} as any, mockSandbox);

        expect(commandHistory).toContain('bun install');
        expect(commandHistory).not.toContain('pnpm install --no-frozen-lockfile');
    });

    it('should use pnpm install if no Bun indicators are present', async () => {
        mockSandbox.runCommand.mockImplementation(async (cmd: string) => {
            commandHistory.push(cmd);
            if (cmd.startsWith('ls ')) return { stdout: 'package.json', exitCode: 0 };
            if (cmd.startsWith('cat ')) return { stdout: '{}', exitCode: 0 };
            return { stdout: '', exitCode: 0 };
        });

        const service = new EnvironmentService();
        await service.refreshDependencies({} as any, mockSandbox);

        expect(commandHistory).toContain('pnpm install --no-frozen-lockfile');
        expect(commandHistory).not.toContain('bun install');
    });
});
