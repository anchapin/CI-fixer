import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';
import { SandboxEnvironment } from '../../sandbox';

describe('ProvisioningService - PATH Management', () => {
  let mockSandbox: SandboxEnvironment;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      teardown: vi.fn(),
    } as any;
  });

  it('should refresh PATH by detecting global npm bin path', async () => {
    vi.mocked(mockSandbox.runCommand).mockImplementation(async (cmd) => {
      if (cmd === 'npm config get prefix') return { stdout: '/usr/local', exitCode: 0, stderr: '' };
      return { stdout: '', exitCode: 0, stderr: '' };
    });

    const service = new ProvisioningService(mockSandbox);
    const pathUpdateCmd = await service.getPathRefreshCommand();

    expect(pathUpdateCmd).toContain('export PATH=$PATH:/usr/local/bin');
  });
});
