import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';
import { SandboxEnvironment } from '../../sandbox';

describe('ProvisioningService', () => {
  let mockSandbox: SandboxEnvironment;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      teardown: vi.fn(),
    } as any;
  });

  it('should install missing node tools using npm', async () => {
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ output: 'success', exitCode: 0 });

    const service = new ProvisioningService(mockSandbox);
    const result = await service.provision('vitest', 'node');

    expect(result).toBe(true);
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm install -g vitest');
  });

  it('should install missing python tools using pip', async () => {
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ output: 'success', exitCode: 0 });

    const service = new ProvisioningService(mockSandbox);
    const result = await service.provision('pytest', 'python');

    expect(result).toBe(true);
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('pip install pytest');
  });

  it('should return false if installation fails', async () => {
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ output: 'error', exitCode: 1 });

    const service = new ProvisioningService(mockSandbox);
    const result = await service.provision('vitest', 'node');

    expect(result).toBe(false);
  });
});
