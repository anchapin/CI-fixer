import { describe, it, expect } from 'vitest';
import { GroundingCoordinator } from '../../../services/grounding/coordinator';
import { GroundingAction } from '../../../services/grounding/types';
import path from 'path';

describe('GroundingCoordinator', () => {
  const rootDir = path.resolve('__tests__/fixtures/grounding/project');
  const coordinator = new GroundingCoordinator(rootDir);

  it('should verify existing file without changes', async () => {
    const result = await coordinator.ground({
      path: 'src/utils/logger.ts',
      action: GroundingAction.READ
    });

    expect(result.success).toBe(true);
    expect(result.originalPath).toBe('src/utils/logger.ts');
    expect(result.groundedPath).toBe('src/utils/logger.ts'); // Normalized?
  });

  it('should auto-correct path if file exists elsewhere (unique)', async () => {
    // backend/v1/api.py -> backend/api.py
    const result = await coordinator.ground({
      path: 'backend/v1/api.py',
      action: GroundingAction.READ
    });

    expect(result.success).toBe(true);
    // Expect normalized forward slashes
    expect(result.groundedPath?.replace(/\\/g, '/')).toBe('backend/api.py');
  });

  it('should fail if file does not exist anywhere', async () => {
    const result = await coordinator.ground({
      path: 'src/ghost.ts',
      action: GroundingAction.READ
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('should fail if multiple matches found (ambiguous)', async () => {
    // src/logger.ts matches src/utils/logger.ts AND backend/logger.ts
    // The coordinator should be strict about ambiguity unless one score is significantly higher?
    // Spec says: "If exactly one high-confidence match is found".
    // Search engine returns ranked list.
    // If top 1 is unique or score difference is high?
    // For now, if length > 1, fail? Or if length > 1, check if top 1 is strictly better?
    // My search engine currently returns sorted list.
    // "src/logger.ts" -> `src/utils/logger.ts` (score 2) vs `backend/logger.ts` (score 1).
    // It should probably pick the top one if score is distinct.
    
    // Let's assume strictness for now: ambiguous if multiple candidates.
    // Wait, spec says "If multiple matches... the operation must fail".
    // But search engine returns "Candidates".
    // If search engine returns [A, B], is it multiple matches?
    // Yes.
    
    const result = await coordinator.ground({
      path: 'src/logger.ts',
      action: GroundingAction.READ
    });

    // Based on "multiple matches... fail", this should fail.
    expect(result.success).toBe(false);
    expect(result.error).toContain('Ambiguous');
  });
});
