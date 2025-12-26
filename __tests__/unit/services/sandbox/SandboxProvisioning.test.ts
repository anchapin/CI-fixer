import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareSandbox } from '../../../../services/sandbox/SandboxService';
import * as sandboxMod from '../../../../sandbox';

vi.mock('../../../../sandbox', () => ({ createSandbox: vi.fn(), }));
vi.mock('fs/promises'); // Mock fs to avoid actual file reads for agent_tools injection

describe('SandboxProvisioning', () => {
    let mockSandbox: any;
    let commandHistory: string[];

    beforeEach(() => {
        vi.resetAllMocks();
        commandHistory = [];

        mockSandbox = {
            getId: () => 'mock-id',
            init: vi.fn(),
            runCommand: vi.fn().mockImplementation(async (cmd: string) => {
                commandHistory.push(cmd);
                
                // Mock 'ls' to return specific files based on query
                if (cmd.startsWith('ls ')) {
                    // Simulate that bun.lockb EXISTS in the repo
                    // But standard ls logic only returns what is asked
                    if (cmd.includes('bun.lockb')) {
                        return { stdout: 'bun.lockb', exitCode: 0 };
                    }
                    if (cmd.includes('bunfig.toml')) {
                        return { stdout: 'bunfig.toml', exitCode: 0 };
                    }
                    // Current implementation asks for: package.json requirements.txt pnpm-lock.yaml pnpm-workspace.yaml
                    // If we only mock those, bun.lockb won't appear
                    return { stdout: 'package.json', exitCode: 0 };
                }

                // Mock git clone
                if (cmd.startsWith('git clone')) return { exitCode: 0 };
                if (cmd.startsWith('git checkout')) return { exitCode: 0 };
                if (cmd.startsWith('rm -rf')) return { exitCode: 0 };
                if (cmd.startsWith('npm install -g typescript')) return { exitCode: 0 };
                if (cmd.startsWith('apt-get update')) return { exitCode: 0 };
                if (cmd.startsWith('curl')) return { exitCode: 0 };

                return { stdout: '', exitCode: 0 };
            }),
            writeFile: vi.fn(),
            readFile: vi.fn(),
        };

        (sandboxMod.createSandbox as any).mockReturnValue(mockSandbox);
    });

    it('should install Bun if bun.lockb is present', async () => {
        // We expect the code to detect bun.lockb and run the install curl command
        // To make this pass currently, we'd need to change the ls mock to return bun.lockb even if not asked? 
        // No, we want to prove the CODE doesn't ask for it.
        
        await prepareSandbox({} as any, 'http://github.com/test/repo');

        const installBunCmd = commandHistory.find(cmd => cmd.includes('bun.sh/install'));
        expect(installBunCmd).toBeDefined();
    });

    it('should install Bun if bunfig.toml is present', async () => {
        // Reset and try again focusing on bunfig
        commandHistory = [];
        mockSandbox.runCommand.mockImplementation(async (cmd: string) => {
             commandHistory.push(cmd);
             if (cmd.startsWith('ls ')) {
                 if (cmd.includes('bunfig.toml')) return { stdout: 'bunfig.toml', exitCode: 0 };
                 return { stdout: 'package.json', exitCode: 0 };
             }
             return { stdout: '', exitCode: 0 };
        });

        await prepareSandbox({} as any, 'http://github.com/test/repo');
        
        const installBunCmd = commandHistory.find(cmd => cmd.includes('bun.sh/install'));
        expect(installBunCmd).toBeDefined();
    });
});
