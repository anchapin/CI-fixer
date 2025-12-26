import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';
import { SandboxEnvironment } from '../../sandbox';

describe('ProvisioningService - Loop Prevention', () => {
  let mockSandbox: SandboxEnvironment;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      teardown: vi.fn(),
    } as any;
  });

  it('should prevent repeated installation attempts for failing tools', async () => {
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: 'failed', exitCode: 1 });

    const service = new ProvisioningService(mockSandbox);
    
    // Attempt 1, 2, 3
    await service.provision('broken-tool', 'node');
    await service.provision('broken-tool', 'node');
    await service.provision('broken-tool', 'node');
    
    // Reset mock to check if it's called on the 4th attempt
    vi.mocked(mockSandbox.runCommand).mockClear();
    
    const result = await service.provision('broken-tool', 'node');
    expect(result).toBe(false);
    expect(mockSandbox.runCommand).not.toHaveBeenCalled();
  });
});
