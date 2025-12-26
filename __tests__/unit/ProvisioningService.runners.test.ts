import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';
import { SandboxEnvironment } from '../../sandbox';

describe('ProvisioningService - Runner Support', () => {
  let mockSandbox: any;
  let service: ProvisioningService;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
    };
    service = new ProvisioningService(mockSandbox as unknown as SandboxEnvironment);
  });

  it('should detect when a runner is already installed', async () => {
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '/usr/bin/pytest', stderr: '', exitCode: 0 });

    const result = await (service as any).ensureRunner('pytest');

    expect(result).toBe(true);
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('which pytest');
    expect(mockSandbox.runCommand).toHaveBeenCalledTimes(1);
  });

  it('should attempt to install a missing python runner', async () => {
    // which fails
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });
    // pip install succeeds
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await (service as any).ensureRunner('pytest');

    expect(result).toBe(true);
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('which pytest');
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('pip install pytest');
  });

  it('should attempt to install a missing node runner', async () => {
    // which fails
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });
    // npm install succeeds
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await (service as any).ensureRunner('vitest');

    expect(result).toBe(true);
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('which vitest');
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm install -g vitest');
  });

  it('should return false if installation fails', async () => {
    // which fails
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });
    // pip install fails
    mockSandbox.runCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 });

    const result = await (service as any).ensureRunner('pytest');

    expect(result).toBe(false);
  });
});
