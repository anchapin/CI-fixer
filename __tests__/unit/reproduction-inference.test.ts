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
    vi.mocked(fs.stat).mockRejectedValue(new Error('File not found'));
  });

  it('should return null when no strategies can infer a command', async () => {
    const result = await service.inferCommand(mockRepoPath);
    expect(result).toBeNull();
  });

  it('should infer command from workflow analysis', async () => {
    // Mock the existence of a workflow file
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

    vi.mocked(fs.stat).mockImplementation((p: string | any) => {
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

  it('should infer command from Node signature (package.json)', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'package.json')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('npm test');
    expect(result?.strategy).toBe('signature');
  });

  it('should infer command from Python signature (pytest.ini)', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'pytest.ini')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('pytest');
    expect(result?.strategy).toBe('signature');
  });

  it('should infer command from Go signature (go.mod)', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'go.mod')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('go test ./...');
    expect(result?.strategy).toBe('signature');
  });

  it('should infer command from Makefile (test target)', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'Makefile')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockResolvedValue('test:\n\tgo test ./...');

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('make test');
    expect(result?.strategy).toBe('build_tool');
  });

  it('should infer command from build.gradle (check target)', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'build.gradle')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    // Ensure Makefile is not found
    vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('./gradlew test');
    expect(result?.strategy).toBe('build_tool');
  });

  it('should infer command from Maven (pom.xml)', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'pom.xml')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('mvn test');
    expect(result?.strategy).toBe('build_tool');
  });

  it('should infer command from Rakefile', async () => {
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'Rakefile')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('rake test');
    expect(result?.strategy).toBe('build_tool');
  });

  it('should prioritize Workflow over Signature', async () => {
    // Both Workflow and package.json exist
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, '.github/workflows') || p === path.join(mockRepoPath, 'package.json')) {
            return Promise.resolve({ isDirectory: () => true, isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readdir).mockResolvedValue(['ci.yml'] as any);
    vi.mocked(fs.readFile).mockResolvedValue('jobs:\n  test:\n    steps:\n      - run: npm run test:custom');

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result?.command).toBe('npm run test:custom');
    expect(result?.strategy).toBe('workflow');
  });

  it('should prioritize Signature over Build Tool', async () => {
    // package.json and Makefile exist
    vi.mocked(fs.stat).mockImplementation((p: string | Buffer | URL) => {
        if (p === path.join(mockRepoPath, 'package.json') || p === path.join(mockRepoPath, 'Makefile')) {
            return Promise.resolve({ isFile: () => true } as any);
        }
        return Promise.reject(new Error('File not found'));
    });
    vi.mocked(fs.readFile).mockImplementation((p: string | Buffer | URL) => {
        if (typeof p === 'string' && p.includes('Makefile')) return Promise.resolve('test:\n\techo test');
        return Promise.reject(new Error('File not found'));
    });

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result?.command).toBe('npm test');
    expect(result?.strategy).toBe('signature');
  });
});
