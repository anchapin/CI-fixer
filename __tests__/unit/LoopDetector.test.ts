
import { describe, it, expect, beforeEach } from 'vitest';
import { LoopDetector } from '../../services/LoopDetector';
import { LoopStateSnapshot } from '../../types';

describe('LoopDetector Service', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  it('should be instantiated', () => {
    expect(detector).toBeDefined();
  });

  it('should return false for detection when history is empty', () => {
    const snapshot: LoopStateSnapshot = {
      iteration: 1,
      filesChanged: ['test.ts'],
      contentChecksum: 'hash1',
      errorFingerprint: 'error1',
      timestamp: Date.now()
    };

    const result = detector.detectLoop(snapshot);
    expect(result.detected).toBe(false);
  });

  it('should track added states', () => {
    const snapshot: LoopStateSnapshot = {
      iteration: 1,
      filesChanged: ['test.ts'],
      contentChecksum: 'hash1',
      errorFingerprint: 'error1',
      timestamp: Date.now()
    };

    detector.addState(snapshot);
    // Assuming we might expose history size or verify via detection logic later
    // For now, just ensuring it doesn't throw and potentially internal state changes
    // We can add a getter for testing if needed, or rely on behavior.
    
    // Let's add a test-only getter or use a public property if we make it public.
    // For TDD, let's assume we can inspect it or just rely on the fact that adding it 
    // enables future detection (which is the next task).
    // But to verify "Basic state tracking", we should verify it IS tracked.
    
    // Let's check if the detector has a method to get history count or similar
    expect((detector as any).history).toBeDefined();
    expect((detector as any).history.length).toBe(1);
  });

  it('should detect a loop when identical state is added', () => {
    const snapshot1: LoopStateSnapshot = {
      iteration: 1,
      filesChanged: ['test.ts'],
      contentChecksum: 'hash1',
      errorFingerprint: 'error1',
      timestamp: Date.now()
    };

    const snapshot2: LoopStateSnapshot = {
      iteration: 2,
      filesChanged: ['test.ts'],
      contentChecksum: 'hash1',
      errorFingerprint: 'error1',
      timestamp: Date.now()
    };

    detector.addState(snapshot1);
    const result = detector.detectLoop(snapshot2);

    expect(result.detected).toBe(true);
    expect(result.duplicateOfIteration).toBe(1);
  });

  it('should not detect loop when content checksum differs', () => {
    const snapshot1: LoopStateSnapshot = {
      iteration: 1,
      filesChanged: ['test.ts'],
      contentChecksum: 'hash1',
      errorFingerprint: 'error1',
      timestamp: Date.now()
    };

    const snapshot2: LoopStateSnapshot = {
      iteration: 2,
      filesChanged: ['test.ts'],
      contentChecksum: 'hash2', // Different checksum
      errorFingerprint: 'error1',
      timestamp: Date.now()
    };

    detector.addState(snapshot1);
    const result = detector.detectLoop(snapshot2);

    expect(result.detected).toBe(false);
  });
});
