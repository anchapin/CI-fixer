import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReproductionInferenceService } from '../../services/reproduction-inference';
import * as fs from 'fs/promises';
import { AppConfig } from '../../types';
import { SandboxEnvironment } from '../../sandbox';

vi.mock('fs/promises');

describe('ReproductionInferenceService - Dry Run', () => {
  let service: ReproductionInferenceService;
  const mockRepoPath = '/mock/repo';
  const mockConfig: AppConfig = {
    githubToken: 'test-token',
    repoUrl: 'https://github.com/test/repo',
    selectedRuns: [],
    devEnv: 'simulation',
    checkEnv: 'simulation'
  };

  beforeEach(() => {
    service = new ReproductionInferenceService();
    vi.clearAllMocks();
    vi.mocked(fs.stat).mockRejectedValue(new Error('File not found'));
  });

  it('should skip a command that fails dry run and try next strategy', async () => {
    // Strategy 1: Signature (package.json) -> npm test
    vi.mocked(fs.stat).mockImplementation(async (p: any) => {
        if (p.toString().includes('package.json')) return { isFile: () => true } as any;
        if (p.toString().includes('tests')) return { isDirectory: () => true } as any;
        throw new Error('File not found');
    });
    vi.mocked(fs.readdir).mockResolvedValue(['package.json', 'tests'] as any);

    const mockSandbox = {
        runCommand: vi.fn()
            .mockResolvedValueOnce({ stdout: '', stderr: 'npm: command not found', exitCode: 127 }) // Dry run fails for npm test
            .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // Dry run succeeds for next one
    } as unknown as SandboxEnvironment;

    // We expect it to try 'npm test' (from signature), fail, then try 'npm test -- tests' (from safe scan) or whatever is next.
    // Wait, signature is higher priority than safe scan.
    
    const result = await service.inferCommand(mockRepoPath, mockConfig, mockSandbox);
    
    expect(result).not.toBeNull();
    expect(result?.command).not.toBe('npm test');
    expect(mockSandbox.runCommand).toHaveBeenCalledTimes(2);
  });
});
