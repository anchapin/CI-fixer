import { describe, it, expect } from 'vitest';
import { extractPaths } from '../../utils/pathDetection';

describe('pathDetection - extractPaths', () => {
  it('should extract paths with separators', () => {
    const command = 'cat src/utils/helper.ts';
    expect(extractPaths(command)).toContain('src/utils/helper.ts');
  });

  it('should extract paths with common extensions', () => {
    const command = 'touch README.md index.tsx';
    const paths = extractPaths(command);
    expect(paths).toContain('README.md');
    expect(paths).toContain('index.tsx');
  });

  it('should handle quoted paths with spaces', () => {
    const command = 'ls "my documents/file with spaces.txt"';
    expect(extractPaths(command)).toContain('my documents/file with spaces.txt');
  });

  it('should handle single quoted paths', () => {
    const command = "rm 'temp files/old.log'";
    expect(extractPaths(command)).toContain('temp files/old.log');
  });

  it('should handle Windows style paths', () => {
    const command = 'type .\\src\\app.tsx';
    expect(extractPaths(command)).toContain('.\\src\\app.tsx');
  });

  it('should ignore shell flags', () => {
    const command = 'ls -la src/index.ts';
    const paths = extractPaths(command);
    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('-la');
  });

  it('should extract paths starting with ./ or ../', () => {
    const command = 'cat ./local.txt ../parent.txt';
    const paths = extractPaths(command);
    expect(paths).toContain('./local.txt');
    expect(paths).toContain('../parent.txt');
  });

  it('should ignore non-path tokens without extensions or separators', () => {
    const command = 'echo hello world';
    expect(extractPaths(command)).toEqual([]);
  });

  it('should handle multiple paths in one command', () => {
    const command = 'cp src/main.ts dist/main.js';
    const paths = extractPaths(command);
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('dist/main.js');
  });
});