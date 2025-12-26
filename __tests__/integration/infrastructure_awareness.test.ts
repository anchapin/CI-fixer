import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analysisNode } from '../../agent/graph/nodes/analysis';
import { prepareSandbox } from '../../services/sandbox/SandboxService';
import { SandboxEnvironment } from '../../sandbox';
import { AgentPhase, ErrorCategory } from '../../types';
import { defaultServices } from '../../services/container';

// Mock the sandbox factory
vi.mock('../../sandbox', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    createSandbox: vi.fn()
  };
});

import { createSandbox } from '../../sandbox';

describe('Infrastructure Awareness Integration', () => {
  let mockSandbox: SandboxEnvironment;
  let logCallback: any;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      teardown: vi.fn(),
      envOverrides: {},
      getId: () => 'test-sandbox',
      getWorkDir: () => '/workspace',
      init: vi.fn().mockResolvedValue(undefined)
    } as any;

    vi.mocked(createSandbox).mockReturnValue(mockSandbox);

    logCallback = vi.fn();
  });

  it('should probe and provision in prepareSandbox', async () => {
    vi.mocked(mockSandbox.runCommand).mockImplementation(async (cmd) => {
        if (cmd.startsWith('ls')) return { stdout: 'package.json', stderr: '', exitCode: 0 };
        if (cmd === 'vitest --version') return { stdout: '', stderr: 'not found', exitCode: 127 };
        if (cmd === 'npm install -g vitest') return { stdout: 'done', stderr: '', exitCode: 0 };
        if (cmd === 'npm config get prefix') return { stdout: '/usr/local', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
    });

    vi.mocked(mockSandbox.readFile).mockResolvedValue(JSON.stringify({ devDependencies: { vitest: '1.0.0' } }));

    await prepareSandbox({ githubToken: 'token' } as any, 'test/repo', 'sha', logCallback);

    expect(logCallback).toHaveBeenCalledWith(AgentPhase.ENVIRONMENT_SETUP, expect.stringContaining('Probing'));
    expect(logCallback).toHaveBeenCalledWith(AgentPhase.PROVISIONING, expect.stringContaining('Installing missing tool: vitest'));
    expect(mockSandbox.envOverrides?.['PATH']).toBe('$PATH:/usr/local/bin');
  });

  it('should detect missing tool and attempt provisioning in analysis node', async () => {
    // 1. Mock "vitest not found" error logs
    const mockState: any = {
      config: { repoUrl: 'test/repo' },
      group: { id: 'run-1', name: 'test', mainRun: { head_sha: 'sha123' }, runIds: [1] },
      iteration: 0,
      currentLogText: 'sh: 1: vitest: not found',
      feedback: [],
      files: {},
      fileReservations: []
    };

    // 2. Mock sandbox commands
    vi.mocked(mockSandbox.runCommand).mockImplementation(async (cmd) => {
      if (cmd.startsWith('ls')) {
        return { stdout: 'package.json', stderr: '', exitCode: 0 };
      }
      if (cmd === 'vitest --version') {
        return { stdout: '', stderr: 'not found', exitCode: 127 };
      }
      if (cmd === 'npm install -g vitest') {
        return { stdout: 'installed', stderr: '', exitCode: 0 };
      }
      if (cmd === 'npm config get prefix') {
        return { stdout: '/usr/local', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    vi.mocked(mockSandbox.readFile).mockResolvedValue(JSON.stringify({ devDependencies: { vitest: '1.0.0' } }));

    const context: any = {
      logCallback,
      sandbox: mockSandbox,
      services: {
          ...defaultServices,
          github: { getWorkflowLogs: vi.fn() },
          analysis: { 
              ...defaultServices.analysis,
              diagnoseError: vi.fn().mockResolvedValue({ summary: 'Missing vitest', filePath: '', fixAction: 'command' }),
              generateRepoSummary: vi.fn().mockResolvedValue('Summary')
          },
          dependency: {
              hasBlockingDependencies: vi.fn().mockResolvedValue(false),
              getBlockedErrors: vi.fn().mockResolvedValue([])
          },
          clustering: {
              clusterError: vi.fn().mockResolvedValue({})
          }
      }
    };

    // 3. Run analysis node
    await analysisNode(mockState, context);

    // 4. Verify provisioning was triggered
    expect(logCallback).toHaveBeenCalledWith(AgentPhase.ENVIRONMENT_SETUP, expect.stringContaining('Detected missing tool'));
    expect(logCallback).toHaveBeenCalledWith(AgentPhase.PROVISIONING, expect.stringContaining('Installing vitest'));
    expect(logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Successfully provisioned vitest'));
    
    // 5. Verify PATH was refreshed in envOverrides
    expect(mockSandbox.envOverrides?.['PATH']).toBe('$PATH:/usr/local/bin');
  });
});
