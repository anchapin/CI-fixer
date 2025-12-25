
import { describe, it, expect } from 'vitest';
import { LoopStateSnapshot, LoopDetectionResult, LoopStateHash } from '../../types';

describe('Loop Detection Types', () => {
  it('should allow creating a LoopStateSnapshot object', () => {
    const snapshot: LoopStateSnapshot = {
      iteration: 1,
      filesChanged: ['src/App.tsx'],
      contentChecksum: 'abc123hash',
      errorFingerprint: 'Error: invalid hook call',
      timestamp: Date.now()
    };
    
    expect(snapshot.iteration).toBe(1);
    expect(snapshot.filesChanged).toContain('src/App.tsx');
  });

  it('should allow creating a LoopDetectionResult object', () => {
    const result: LoopDetectionResult = {
      detected: true,
      message: 'Loop detected',
      duplicateOfIteration: 2
    };

    expect(result.detected).toBe(true);
    expect(result.duplicateOfIteration).toBe(2);
  });

  it('should handle LoopStateHash as a string alias', () => {
    const hash: LoopStateHash = 'some-hash-string';
    expect(typeof hash).toBe('string');
  });
});
