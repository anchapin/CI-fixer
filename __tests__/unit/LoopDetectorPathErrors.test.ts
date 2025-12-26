import { describe, it, expect, beforeEach } from 'vitest';
import { LoopDetector } from '../../services/LoopDetector';
import { LoopStateSnapshot } from '../../types';

describe('LoopDetector - Path Errors', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  it('should not trigger strategy shift on first hallucination', () => {
    detector.recordHallucination('non_existent.ts');
    expect(detector.shouldTriggerStrategyShift('non_existent.ts')).toBe(false);
  });

  it('should trigger strategy shift on second consecutive hallucination', () => {
    detector.recordHallucination('non_existent.ts');
    detector.recordHallucination('non_existent.ts');
    expect(detector.shouldTriggerStrategyShift('non_existent.ts')).toBe(true);
  });

  it('should not trigger strategy shift if hallucinations are for different paths', () => {
    detector.recordHallucination('non_existent.ts');
    detector.recordHallucination('another_non_existent.ts');
    expect(detector.shouldTriggerStrategyShift('non_existent.ts')).toBe(false);
    expect(detector.shouldTriggerStrategyShift('another_non_existent.ts')).toBe(false);
  });

  it('should reset consecutive count when a different path is hallucinated', () => {
    detector.recordHallucination('non_existent.ts');
    detector.recordHallucination('another_non_existent.ts');
    detector.recordHallucination('non_existent.ts');
    expect(detector.shouldTriggerStrategyShift('non_existent.ts')).toBe(false);
  });

  it('should return a glob search command on trigger', () => {
    detector.recordHallucination('non_existent.ts');
    detector.recordHallucination('non_existent.ts');
    const recoveryCommand = detector.triggerAutomatedRecovery();
    expect(recoveryCommand).toEqual('glob("**/non_existent.ts")');
  });
});
