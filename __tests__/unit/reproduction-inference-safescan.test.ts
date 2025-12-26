import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReproductionInferenceService } from '../../services/reproduction-inference';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AppConfig } from '../../types';

vi.mock('fs/promises');

describe('ReproductionInferenceService - Safe Scan', () => {
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

  it('should infer command using Safe Scan when other strategies fail and a test directory is found', async () => {
    // Mock readdir to return a tests directory
    vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
        if (p === mockRepoPath) return ['src', 'tests', 'README.md'] as any;
        return [] as any;
    });

    vi.mocked(fs.stat).mockImplementation(async (p: any) => {
        if (p === '/mock/repo/tests' || p === path.join(mockRepoPath, 'tests')) {
            return { isDirectory: () => true } as any;
        }
        throw new Error('File not found');
    });

    const result = await service.inferCommand(mockRepoPath, mockConfig);
    
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe('safe_scan');
    expect(result?.command).toContain('tests');
  });

  it('should infer command using Safe Scan when a root test file is found', async () => {
    // Mock readdir to return a test.py file
    vi.mocked(fs.readdir).mockImplementation(async (p: any) => {
        if (p === mockRepoPath) return ['src', 'test.py', 'README.md'] as any;
        return [] as any;
    });

    const result = await service.inferCommand(mockRepoPath, mockConfig);
    
    expect(result).not.toBeNull();
    expect(result?.strategy).toBe('safe_scan');
    expect(result?.command).toBe('python test.py');
  });
});
