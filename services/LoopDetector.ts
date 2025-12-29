import { LoopStateSnapshot, LoopDetectionResult } from '../types';
// NOTE: recordLoopDetected removed from telemetry/metrics to prevent database import in frontend
// Metrics service imports db/client.js which requires Node.js environment
// TODO: Re-enable metrics tracking in server-side context only

export class LoopDetector {
  private history: LoopStateSnapshot[] = [];
  private stateMap: Map<string, number> = new Map(); // Hash -> Iteration ID
  private hallucinationCounts: Map<string, number> = new Map();
  private lastHallucinatedPath: string | null = null;
  private consecutiveHallucinations: number = 0;

  constructor() {}

  public getLastHallucinatedPath(): string | null {
    return this.lastHallucinatedPath;
  }

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

  triggerAutomatedRecovery(): string | null {
    if (this.lastHallucinatedPath && this.shouldTriggerStrategyShift(this.lastHallucinatedPath)) {
      // Return a glob search command for the last hallucinated path
      return `glob("**/non_existent.ts")`.replace('non_existent.ts', this.lastHallucinatedPath);
    }
    return null;
  }

  detectLoop(currentState: LoopStateSnapshot): LoopDetectionResult {
    const hash = this.generateHash(currentState);
    
    if (this.stateMap.has(hash)) {
      const previousIteration = this.stateMap.get(hash);
      
      if (previousIteration !== undefined) {
        // recordLoopDetected(previousIteration, hash); // Disabled for frontend compatibility
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
