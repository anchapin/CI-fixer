
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { prepareSandbox } from '../../../../services/sandbox/SandboxService';
import { createSandbox } from '../../../../sandbox';
import { AppConfig } from '../../../../types';

vi.mock('../../../../sandbox');

describe('SandboxService - Bun Support', () => {
    let mockSandbox: any;

    beforeEach(() => {
        mockSandbox = {
            init: vi.fn(),
            getId: vi.fn().mockReturnValue('test-sandbox-id'),
            runCommand: vi.fn().mockImplementation((cmd) => {
                if (cmd.includes('ls package.json')) {
                    // Simulate bun.lockb presence
                    return Promise.resolve({ exitCode: 0, stdout: 'package.json\nbun.lockb', stderr: '' });
                }
                return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
            }),
            writeFile: vi.fn(),
            kill: vi.fn()
        };
        (createSandbox as any).mockReturnValue(mockSandbox);
    });

    it('should install bun if bun.lockb is detected', async () => {
        const config: AppConfig = {
            githubToken: 'test-token',
            repoUrl: 'owner/repo',
        } as any;

        await prepareSandbox(config, 'https://github.com/owner/repo', 'sha123');

        // Check if curl bun install was called
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringContaining('curl -fsSL https://bun.sh/install | bash'));
        
        // Check if bun install was called
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringContaining('bun install'));
    });
});
