import { GraphState } from '../agent/graph/state.js';
import { ClassifiedError } from '../errorClassification.js';

export interface ConvergenceStatus {
    isConverging: boolean;
    isStable: boolean;
    isDiverging: boolean;
    trend: 'decreasing' | 'stable' | 'increasing' | 'unknown';
}

/**
 * Estimates the complexity of a problem based on multiple heuristics.
 * Higher scores indicate more complex problems requiring more iterations.
 * 
 * Scoring factors:
 * - Error category (DEPENDENCY=3, CONFIG=2, SYNTAX=1, etc.)
 * - Number of files affected
 * - Feedback accumulation (indicates difficulty)
 * - Diagnosis confidence (inverse relationship)
 * - Classification confidence
 */
export function estimateComplexity(state: GraphState): number {
    let score = 0;

    // 1. Error Category Weight
    if (state.classification) {
        const categoryWeights: Record<string, number> = {
            'DEPENDENCY': 3,
            'ENVIRONMENT': 3,
            'CONFIG': 2,
            'LOGIC': 2,
            'SYNTAX': 1,
            'IMPORT': 1,
            'TYPE': 1,
            'UNKNOWN': 4 // Unknown errors are hardest
        };
        score += categoryWeights[state.classification.category] || 2;
    }

    // 2. File Count (more files = more complexity)
    score += state.fileReservations.length * 2;

    // 3. Feedback Accumulation (indicates difficulty/iteration count)
    // Each feedback item suggests a failed attempt
    score += state.feedback.length * 1.5;

    // 4. Diagnosis Confidence (inverse - low confidence = high complexity)
    if (state.diagnosis?.confidence !== undefined) {
        score += (1 - state.diagnosis.confidence) * 5;
    }

    // 5. Classification Confidence (inverse)
    if (state.classification?.confidence !== undefined) {
        score += (1 - state.classification.confidence) * 3;
    }

    // 6. Iteration Count (later iterations suggest stuck problem)
    score += state.iteration * 0.5;

    return Math.round(score * 10) / 10; // Round to 1 decimal
}

/**
 * Detects convergence patterns in complexity history.
 * 
 * Convergence: Complexity is decreasing over time (problem simplifying)
 * Stable: Complexity has plateaued (atomic state reached)
 * Divergence: Complexity is increasing (decomposition failed)
 */
export function detectConvergence(history: number[]): ConvergenceStatus {
    if (history.length < 2) {
        return {
            isConverging: false,
            isStable: false,
            isDiverging: false,
            trend: 'unknown'
        };
    }

    // Look at last 3 data points (or all if less than 3)
    const windowSize = Math.min(3, history.length);
    const recentHistory = history.slice(-windowSize);

    // Calculate trend
    let increases = 0;
    let decreases = 0;
    let stable = 0;

    for (let i = 1; i < recentHistory.length; i++) {
        const diff = recentHistory[i] - recentHistory[i - 1];
        if (Math.abs(diff) < 0.5) {
            stable++;
        } else if (diff > 0) {
            increases++;
        } else {
            decreases++;
        }
    }

    // Determine status
    const isConverging = decreases > increases;
    const isStable = stable >= recentHistory.length - 1;
    const isDiverging = increases > decreases && !isStable;

    let trend: 'decreasing' | 'stable' | 'increasing' | 'unknown' = 'unknown';
    if (isStable) trend = 'stable';
    else if (isConverging) trend = 'decreasing';
    else if (isDiverging) trend = 'increasing';

    return {
        isConverging,
        isStable,
        isDiverging,
        trend
    };
}

/**
 * Determines if a problem has reached an "atomic" state.
 * 
 * Atomic problems are:
 * - Low complexity (< 5)
 * - Stable over 2+ iterations
 * - Self-contained and directly solvable
 */
export function isAtomic(complexity: number, history: number[]): boolean {
    // Must have low complexity
    if (complexity >= 5) {
        return false;
    }

    // Must have history to determine stability
    if (history.length < 2) {
        return false;
    }

    // Check if stable
    const convergence = detectConvergence(history);

    return convergence.isStable && complexity < 5;
}

/**
 * Provides a human-readable explanation of the complexity score.
 */
export function explainComplexity(state: GraphState, complexity: number): string {
    const parts: string[] = [];

    if (state.classification) {
        parts.push(`Error type: ${state.classification.category}`);
    }

    if (state.fileReservations.length > 0) {
        parts.push(`${state.fileReservations.length} file(s) affected`);
    }

    if (state.feedback.length > 0) {
        parts.push(`${state.feedback.length} previous attempt(s)`);
    }

    if (state.diagnosis?.confidence !== undefined && state.diagnosis.confidence < 0.7) {
        parts.push(`Low diagnosis confidence (${(state.diagnosis.confidence * 100).toFixed(0)}%)`);
    }

    const level = complexity < 3 ? 'Low' : complexity < 6 ? 'Medium' : 'High';

    return `${level} complexity (${complexity}): ${parts.join(', ')}`;
}
