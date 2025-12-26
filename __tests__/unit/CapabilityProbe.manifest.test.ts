import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityProbe } from '../../services/sandbox/CapabilityProbe';
import { SandboxEnvironment } from '../../sandbox';

describe('CapabilityProbe - Manifest Mapping', () => {
  let mockSandbox: SandboxEnvironment;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      teardown: vi.fn(),
    } as any;
  });

  it('should identify required binaries from package.json', async () => {
    vi.mocked(mockSandbox.readFile).mockImplementation(async (path) => {
      if (path === 'package.json') {
        return JSON.stringify({
          devDependencies: {
            'vitest': '^1.0.0'
          }
        });
      }
      throw new Error('File not found');
    });

    const probe = new CapabilityProbe(mockSandbox);
    const required = await probe.getRequiredTools();

    expect(required).toContain('vitest');
    expect(required).toContain('npm'); // node/npm are always required if package.json exists
  });

  it('should identify required binaries from requirements.txt', async () => {
    vi.mocked(mockSandbox.readFile).mockImplementation(async (path) => {
      if (path === 'requirements.txt') {
        return 'pytest==7.0.0\nrequests>=2.0.0';
      }
      throw new Error('File not found');
    });

    const probe = new CapabilityProbe(mockSandbox);
    const required = await probe.getRequiredTools();

    expect(required).toContain('pytest');
    expect(required).toContain('python'); // python/pip are always required if requirements.txt exists
  });
});
