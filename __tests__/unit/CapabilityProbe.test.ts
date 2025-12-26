import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityProbe } from '../../services/sandbox/CapabilityProbe';
import { SandboxEnvironment } from '../../sandbox';

describe('CapabilityProbe', () => {
  let mockSandbox: SandboxEnvironment;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      teardown: vi.fn(),
    } as any;
  });

  it('should detect available tools using --version', async () => {
    vi.mocked(mockSandbox.runCommand).mockImplementation(async (cmd) => {
      if (cmd === 'node --version') return { output: 'v20.0.0', exitCode: 0 };
      if (cmd === 'npm --version') return { output: '9.0.0', exitCode: 0 };
      return { output: 'not found', exitCode: 127 };
    });

    const probe = new CapabilityProbe(mockSandbox);
    const capabilities = await probe.probe(['node', 'npm', 'pytest']);

    expect(capabilities.get('node')).toBe(true);
    expect(capabilities.get('npm')).toBe(true);
    expect(capabilities.get('pytest')).toBe(false);
  });
});
