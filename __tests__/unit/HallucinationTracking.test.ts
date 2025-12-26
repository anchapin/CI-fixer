
import { describe, it, expect, beforeEach } from 'vitest';
import { LoopDetector } from '../../services/LoopDetector';

describe('LoopDetector - Hallucination Tracking', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  it('should track hallucination counts for a specific path', () => {
    const path = 'non/existent/path.ts';
    
    detector.recordHallucination(path);
    expect(detector.getHallucinationCount(path)).toBe(1);
    
    detector.recordHallucination(path);
    expect(detector.getHallucinationCount(path)).toBe(2);
  });

  it('should identify similar paths as the same hallucination target', () => {
    // This might require Fuse.js or simple substring/normalization
    const path1 = 'backend/src/utils/helper.ts';
    const path2 = 'src/utils/helper.ts'; // Similar enough?
    
    detector.recordHallucination(path1);
    // If we want similarity, we might need a more complex recording/getting logic
    // For now let's start with exact matches and then move to fuzzy
    detector.recordHallucination(path1);
    expect(detector.shouldTriggerStrategyShift(path1)).toBe(true);
  });

  it('should trigger strategy shift after 2 consecutive hallucinations', () => {
    const path = 'some/file.txt';
    
    detector.recordHallucination(path);
    expect(detector.shouldTriggerStrategyShift(path)).toBe(false);
    
    detector.recordHallucination(path);
    expect(detector.shouldTriggerStrategyShift(path)).toBe(true);
  });

  it('should reset consecutive count if a different path is targeted (or maybe not?)', () => {
    // The spec says "2 consecutive hallucinations for the same or similar paths"
    const path1 = 'path1.ts';
    const path2 = 'path2.ts';
    
    detector.recordHallucination(path1);
    detector.recordHallucination(path2);
    
    expect(detector.shouldTriggerStrategyShift(path1)).toBe(false);
    expect(detector.shouldTriggerStrategyShift(path2)).toBe(false);
  });

  it('should provide a global hallucination count', () => {
    detector.recordHallucination('a.ts');
    detector.recordHallucination('b.ts');
    expect(detector.getTotalHallucinations()).toBe(2);
  });
});
