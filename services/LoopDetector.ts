import { LoopStateSnapshot, LoopDetectionResult } from '../types';

export class LoopDetector {
  private history: LoopStateSnapshot[] = [];

  constructor() {}

  addState(state: LoopStateSnapshot): void {
    this.history.push(state);
  }

  detectLoop(currentState: LoopStateSnapshot): LoopDetectionResult {
    // Basic implementation: No actual detection logic yet (next task)
    return {
      detected: false,
    };
  }
}
