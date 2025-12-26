import { LoopStateSnapshot, LoopDetectionResult } from '../types';
import { recordLoopDetected } from '../telemetry/metrics';

export class LoopDetector {
  private history: LoopStateSnapshot[] = [];
  private stateMap: Map<string, number> = new Map(); // Hash -> Iteration ID
  private hallucinationCounts: Map<string, number> = new Map();
  private lastHallucinatedPath: string | null = null;
  private consecutiveHallucinations: number = 0;

  constructor() {}

  addState(state: LoopStateSnapshot): void {
    this.history.push(state);
    const hash = this.generateHash(state);
    // Store the first occurrence of this hash
    if (!this.stateMap.has(hash)) {
      this.stateMap.set(hash, state.iteration);
    }
  }

  recordHallucination(path: string): void {
    const count = this.hallucinationCounts.get(path) || 0;
    this.hallucinationCounts.set(path, count + 1);

    if (this.lastHallucinatedPath === path) {
      this.consecutiveHallucinations++;
    } else {
      this.lastHallucinatedPath = path;
      this.consecutiveHallucinations = 1;
    }
  }

  getHallucinationCount(path: string): number {
    return this.hallucinationCounts.get(path) || 0;
  }

  getTotalHallucinations(): number {
    return Array.from(this.hallucinationCounts.values()).reduce((a, b) => a + b, 0);
  }

  shouldTriggerStrategyShift(path: string): boolean {
    return this.lastHallucinatedPath === path && this.consecutiveHallucinations >= 2;
  }

  detectLoop(currentState: LoopStateSnapshot): LoopDetectionResult {
    const hash = this.generateHash(currentState);
    
    if (this.stateMap.has(hash)) {
      const previousIteration = this.stateMap.get(hash);
      
      if (previousIteration !== undefined) {
        recordLoopDetected(previousIteration, hash);
      }

      return {
        detected: true,
        duplicateOfIteration: previousIteration,
        message: `Loop detected: State matches iteration ${previousIteration}.`
      };
    }

    return {
      detected: false,
    };
  }

  private generateHash(state: LoopStateSnapshot): string {
    const sortedFiles = [...state.filesChanged].sort().join(',');
    // format: files|checksum|error
    return `${sortedFiles}|${state.contentChecksum}|${state.errorFingerprint}`;
  }
}
