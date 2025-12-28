import { describe, it, expect } from 'vitest';
import { GroundingRequestSchema, GroundingResultSchema, GroundingAction } from '../../../services/grounding/types';

describe('Grounding Types', () => {
  it('should validate a valid GroundingRequest', () => {
    const validRequest = {
      path: '/some/path/file.txt',
      action: 'read',
      context: { source: 'agent' }
    };
    
    // This will fail if Schema is undefined or doesn't parse
    const parsed = GroundingRequestSchema.parse(validRequest);
    expect(parsed).toEqual(validRequest);
  });

  it('should validate a valid GroundingResult', () => {
    const validResult = {
      originalPath: '/some/bad/path.txt',
      groundedPath: '/some/good/path.txt',
      success: true,
      confidence: 1.0,
      action: 'read'
    };

    const parsed = GroundingResultSchema.parse(validResult);
    expect(parsed).toEqual(validResult);
  });

  it('should export GroundingAction enum/type', () => {
    expect(GroundingAction).toBeDefined();
  });
});
