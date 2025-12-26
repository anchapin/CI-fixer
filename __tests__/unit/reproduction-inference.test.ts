import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReproductionInferenceService } from '../../services/reproduction-inference';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('ReproductionInferenceService', () => {
  let service: ReproductionInferenceService;
  const mockRepoPath = '/mock/repo';

  beforeEach(() => {
    service = new ReproductionInferenceService();
    vi.clearAllMocks();
  });

  it('should return null when no strategies can infer a command', async () => {
    const result = await service.inferCommand(mockRepoPath);
    expect(result).toBeNull();
  });

  it('should infer command from workflow analysis', async () => {
    // Mock the existence of a workflow file
    const workflowPath = path.join(mockRepoPath, '.github/workflows/ci.yml');
    const workflowContent = `
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test -- --coverage
    `;

    vi.mocked(fs.stat).mockImplementation((p: any) => {
        if (p === path.join(mockRepoPath, '.github/workflows')) {
            return Promise.resolve({ isDirectory: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readdir).mockResolvedValue(['ci.yml'] as any);
    vi.mocked(fs.readFile).mockResolvedValue(workflowContent);

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('npm test -- --coverage');
    expect(result?.strategy).toBe('workflow');
    expect(result?.reasoning).toContain('ci.yml');
  });
});
