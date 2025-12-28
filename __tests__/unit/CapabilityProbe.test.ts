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
      if (cmd === 'node --version') return { stdout: 'v20.0.0', stderr: '', exitCode: 0 };
      if (cmd === 'npm --version') return { stdout: '9.0.0', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: 'not found', exitCode: 127 };
    });

    const probe = new CapabilityProbe(mockSandbox);
    const capabilities = await probe.probe(['node', 'npm', 'pytest']);

    expect(capabilities.get('node')).toBe(true);
    expect(capabilities.get('npm')).toBe(true);
    expect(capabilities.get('pytest')).toBe(false);
  });
});
