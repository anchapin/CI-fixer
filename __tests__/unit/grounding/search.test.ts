import { describe, it, expect } from 'vitest';
import { PathAwareSearchEngine } from '../../../services/grounding/search';
import path from 'path';

describe('PathAwareSearchEngine', () => {
  const rootDir = path.resolve('__tests__/fixtures/grounding/project');
  const engine = new PathAwareSearchEngine(rootDir);

  it('should find a file when path is correct', async () => {
    const candidates = await engine.findCandidates('src/utils/logger.ts');
    // Candidates should return relative paths to rootDir for easier matching
    expect(candidates).toContain('src/utils/logger.ts');
  });

  it('should find a file by name even if directory is wrong', async () => {
    // Missing 'utils' in path
    const candidates = await engine.findCandidates('src/logger.ts');
    // It should find the real file
    // Note: Normalize separators if on windows
    const normalized = candidates.map(p => p.replace(/\\/g, '/'));
    expect(normalized).toContain('src/utils/logger.ts');
  });

  it('should prioritize matches with common path segments', async () => {
    // We have src/utils/logger.ts and backend/logger.ts
    // Searching for src/logger.ts should prioritize src/utils/logger.ts
    const candidates = await engine.findCandidates('src/logger.ts');
    const normalized = candidates.map(p => p.replace(/\\/g, '/'));
    
    expect(normalized.length).toBeGreaterThanOrEqual(2);
    expect(normalized[0]).toBe('src/utils/logger.ts');
  });

  it('should return empty array if file does not exist anywhere', async () => {
    const candidates = await engine.findCandidates('src/nonexistent.ts');
    expect(candidates).toEqual([]);
  });

  it('should return single candidate directly if only one match found', async () => {
    // api.py is unique in our fixtures
    const candidates = await engine.findCandidates('backend/v1/api.py');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].replace(/\\/g, '/')).toBe('backend/api.py');
  });
});
