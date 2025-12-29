import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReproductionInferenceService } from '../../services/reproduction-inference';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as llm from '../../services/llm/LLMService';

vi.mock('fs/promises');
vi.mock('../../services/llm/LLMService', async () => {
    const actual = await vi.importActual('../../services/llm/LLMService');
    return {
        ...actual as any,
        unifiedGenerate: vi.fn()
    };
});

describe('ReproductionInferenceService - Targeted Workflow Inference', () => {
  let service: ReproductionInferenceService;
  const mockRepoPath = '/mock/repo';
  const mockConfig = {
    githubToken: 'fake',
    repoUrl: 'fake'
  } as any;

  beforeEach(() => {
    service = new ReproductionInferenceService();
    vi.clearAllMocks();
    vi.mocked(fs.stat).mockRejectedValue(new Error('File not found'));
  });

  it('should infer command using LLM when workflow and log are provided', async () => {
    const failedWorkflowPath = '.github/workflows/complex.yml';
    const logText = 'Error: some test failed in step "Run Integration Tests"';
    
    vi.mocked(fs.stat).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, failedWorkflowPath)) return Promise.resolve({ isFile: () => true } as any);
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockResolvedValue('jobs: ...');
    vi.mocked(llm.unifiedGenerate).mockResolvedValue({
        text: JSON.stringify({
            command: 'npm run test:integration',
            reasoning: 'Log shows integration tests failed'
        })
    } as any);

    const result = await service.inferCommand(mockRepoPath, mockConfig, undefined, {
        workflowPath: failedWorkflowPath,
        logText
    });

    expect(result?.command).toBe('npm run test:integration');
    expect(result?.strategy).toBe('workflow');
    expect(llm.unifiedGenerate).toHaveBeenCalled();
  });

  it('should infer command from a specific failed workflow path', async () => {
    const failedWorkflowPath = '.github/workflows/specific-test.yml';
    const workflowContent = `
name: Specific Test
jobs:
  build:
    steps:
      - run: npm install
      - name: Failing Step
        run: npm run test:failing
    `;

    vi.mocked(fs.stat).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, failedWorkflowPath)) {
            return Promise.resolve({ isFile: () => true, isDirectory: () => false } as any);
        }
        if (p === path.join(mockRepoPath, '.github/workflows')) {
             return Promise.resolve({ isDirectory: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, failedWorkflowPath)) {
            return Promise.resolve(workflowContent);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readdir).mockResolvedValue(['specific-test.yml'] as any);

    // We pass the failure context as the 4th argument (to be added)
    const result = await (service as any).inferCommand(mockRepoPath, undefined, undefined, {
        workflowPath: failedWorkflowPath
    });
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('npm run test:failing');
    expect(result?.strategy).toBe('workflow');
    expect(result?.reasoning).toContain('specific-test.yml');
  });

  it('should pick the correct step when multiple run commands exist', async () => {
    const failedWorkflowPath = '.github/workflows/multi-step.yml';
    const workflowContent = `
jobs:
  test:
    steps:
      - run: echo "hello"
      - run: python -m pip install .
      - name: Actual Test
        run: pytest tests/unit
    `;

    vi.mocked(fs.stat).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, failedWorkflowPath)) {
            return Promise.resolve({ isFile: () => true, isDirectory: () => false } as any);
        }
        if (p === path.join(mockRepoPath, '.github/workflows')) {
             return Promise.resolve({ isDirectory: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockResolvedValue(workflowContent);
    vi.mocked(fs.readdir).mockResolvedValue(['multi-step.yml'] as any);

    const result = await (service as any).inferCommand(mockRepoPath, undefined, undefined, {
        workflowPath: failedWorkflowPath
    });
    
    expect(result?.command).toBe('pytest tests/unit');
  });

  it('should prioritize the specific failed workflow over others', async () => {
    const failedWorkflowPath = '.github/workflows/correct.yml';
    const otherWorkflowPath = '.github/workflows/other.yml';
    
    const correctContent = `
jobs:
  test:
    steps:
      - run: npm run correct-test
    `;
    const otherContent = `
jobs:
  test:
    steps:
      - run: npm run wrong-test
    `;

    vi.mocked(fs.stat).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, '.github/workflows')) return Promise.resolve({ isDirectory: () => true } as any);
        if (p === path.join(mockRepoPath, failedWorkflowPath)) return Promise.resolve({ isFile: () => true, isDirectory: () => false } as any);
        if (p === path.join(mockRepoPath, otherWorkflowPath)) return Promise.resolve({ isFile: () => true, isDirectory: () => false } as any);
        return Promise.reject(new Error('File not found'));
    });

    vi.mocked(fs.readdir).mockResolvedValue(['other.yml', 'correct.yml'] as any);
    
    vi.mocked(fs.readFile).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, failedWorkflowPath)) return Promise.resolve(correctContent);
        if (p === path.join(mockRepoPath, otherWorkflowPath)) return Promise.resolve(otherContent);
        return Promise.reject(new Error('File not found'));
    });

    // If we DON'T pass the context, it picks 'other.yml' first because it's first in readdir
    const resultWithoutContext = await service.inferCommand(mockRepoPath);
    expect(resultWithoutContext?.command).toBe('npm run wrong-test');

    // If we DO pass the context, it currently still picks 'other.yml' because it ignores the context
    // THIS SHOULD FAIL (or rather, resultWithContext.command will be 'npm run wrong-test' instead of 'correct-test')
    const resultWithContext = await (service as any).inferCommand(mockRepoPath, undefined, undefined, {
        workflowPath: failedWorkflowPath
    });
    expect(resultWithContext?.command).toBe('npm run correct-test');
  });

  it('should handle multi-line run commands', async () => {
    const failedWorkflowPath = '.github/workflows/multiline.yml';
    const workflowContent = `
jobs:
  test:
    steps:
      - name: Multi-line Test
        run: |
          npm install
          npm test
    `;

    vi.mocked(fs.stat).mockImplementation((p: string | any) => {
        if (p === path.join(mockRepoPath, failedWorkflowPath)) return Promise.resolve({ isFile: () => true, isDirectory: () => false } as any);
        if (p === path.join(mockRepoPath, '.github/workflows')) return Promise.resolve({ isDirectory: () => true } as any);
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockResolvedValue(workflowContent);
    vi.mocked(fs.readdir).mockResolvedValue(['multiline.yml'] as any);

    const result = await (service as any).inferCommand(mockRepoPath, undefined, undefined, {
        workflowPath: failedWorkflowPath
    });
    
    expect(result?.command).toContain('npm test');
    expect(result?.command).toContain('npm install');
  });
});

