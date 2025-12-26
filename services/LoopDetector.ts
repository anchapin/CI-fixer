import { LoopStateSnapshot, LoopDetectionResult } from '../types';
import { recordLoopDetected } from '../telemetry/metrics';

export class LoopDetector {
  private history: LoopStateSnapshot[] = [];
  private stateMap: Map<string, number> = new Map(); // Hash -> Iteration ID

  constructor() {}

  addState(state: LoopStateSnapshot): void {
    this.history.push(state);
    const hash = this.generateHash(state);
    // Store the first occurrence of this hash
    if (!this.stateMap.has(hash)) {
      this.stateMap.set(hash, state.iteration);
    }
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
