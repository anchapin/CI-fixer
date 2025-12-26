
import { describe, it, expect, vi } from 'vitest';
import { findClosestExistingParent } from '../../utils/pathDetection';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');

describe('PathValidator - findClosestExistingParent', () => {
  it('should return the path itself if it exists', () => {
    const targetPath = 'src/index.ts';
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = findClosestExistingParent(targetPath);
    expect(result).toBe(path.resolve(targetPath));
  });

  it('should return the parent directory if the file does not exist but the directory does', () => {
    const targetPath = 'src/non-existent.ts';
    const existingDir = path.resolve('src');

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p !== 'string') return false;
      const normalizedP = path.resolve(p);
      return normalizedP === existingDir;
    });

    const result = findClosestExistingParent(targetPath);
    expect(result).toBe(existingDir);
  });

  it('should traverse up multiple levels to find an existing parent', () => {
    const targetPath = 'a/b/c/d/file.ts';
    const existingDir = path.resolve('a/b');
    const nonExistingDir = path.resolve('a/b/c');

    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p !== 'string') return false;
      const normalizedP = path.resolve(p);
      return normalizedP.startsWith(existingDir) && !normalizedP.startsWith(nonExistingDir);
    });

    const result = findClosestExistingParent(targetPath);
    expect(result).toBe(existingDir);
  });

  it('should return root directory if no parents exist (unlikely but possible)', () => {
    const targetPath = '/non/existent/path';
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = findClosestExistingParent(targetPath);
    // On windows it might be C:\ or similar, on linux /
    expect(result).toBe(path.parse(path.resolve(targetPath)).root);
  });
});
