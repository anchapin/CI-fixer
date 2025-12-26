import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { readFile, writeFile } from '../../services/sandbox/agent_tools';
import { validatePath } from '../../utils/pathDetection';

vi.mock('fs');
vi.mock('../../utils/pathDetection', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validatePath: vi.fn(),
  };
});

describe('agent_tools - readFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return suggestions in error message if path is not found', async () => {
    // Mock validatePath to return suggestions
    vi.mocked(validatePath).mockReturnValue({
        valid: false,
        exists: false,
        absolutePath: '/mock/path/hallucination.ts',
        closestParent: '/mock/path',
        suggestions: ['/mock/path/real_file.ts']
    });

    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await readFile('hallucination.ts');
    expect(result).toContain('Error: Path NOT FOUND');
    expect(result).toContain('Did you mean:');
    expect(result).toContain('real_file.ts');
  });
});

describe('agent_tools - writeFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return error if target is a directory', async () => {
    vi.mocked(validatePath).mockReturnValue({
        valid: true,
        exists: true,
        absolutePath: '/mock/path/existing_dir',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any);

    const result = await writeFile('existing_dir', 'some content');
    expect(result).toContain('is a directory, not a file');
  });
});
