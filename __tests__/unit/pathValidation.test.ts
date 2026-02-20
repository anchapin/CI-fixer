import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { validatePath } from '../../utils/pathDetection';

vi.mock('fs');

describe('pathDetection - validatePath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return valid: true if file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const result = validatePath('existing/file.ts');
    expect(result.valid).toBe(true);
    expect(result.exists).toBe(true);
  });

  it('should return valid: false and exists: false if file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    // Mock readdirSync for fuzzy matching (empty for now)
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    
    const result = validatePath('non/existent/file.ts');
    expect(result.valid).toBe(false);
    expect(result.exists).toBe(false);
  });

  it('should suggest closest parent if path is deeply nested and missing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        // The specific file should not exist
        if (pathStr.includes('non-existent')) return false;
        // But the parent dir should exist
        if (pathStr === 'src/utils' || pathStr.endsWith('/src/utils')) return true;
        return false;
    });

    const result = validatePath('src/utils/non-existent/sub/file.ts');
    expect(result.valid).toBe(false);
    expect(result.closestParent).toBeDefined();
    // Assuming resolve logic is used internally
  });
});

describe('pathDetection - fuzzyMatchPath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return suggestions for a mistyped filename', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes('pathDetecton.ts')) return false;
        return true;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
        'pathDetection.ts',
        'parsing.ts',
        'logger.ts'
    ] as any);

    const result = validatePath('utils/pathDetecton.ts');
    expect(result.exists).toBe(false);
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions?.length).toBeGreaterThan(0);
    expect(result.suggestions![0]).toMatch(/pathDetection\.ts/);
  });

  it('should return empty suggestions if no match found', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (p.toString().includes('completely-different.ts')) return false;
        return true;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
        'a.ts',
        'b.ts'
    ] as any);

    const result = validatePath('utils/completely-different.ts');
    expect(result.exists).toBe(false);
    expect(result.suggestions).toHaveLength(0);
  });
});