/**
 * Patch Ranking Module
 * Implements multi-criteria ranking for patch candidates
 */

import { PatchCandidate } from './patch-generation.js';
import { ValidationResult } from './patch-validation.js';

export interface RankingCriteria {
    validationWeight: number;      // 0-1, weight for validation results
    confidenceWeight: number;       // 0-1, weight for LLM confidence
    simplicityWeight: number;       // 0-1, weight for code simplicity
    executionTimeWeight: number;    // 0-1, weight for fast execution
}

export interface RankedPatch {
    patch: PatchCandidate;
    validation?: ValidationResult;
    score: number;
    rank: number;
    breakdown: {
        validationScore: number;
        confidenceScore: number;
        simplicityScore: number;
        executionTimeScore: number;
    };
}

const DEFAULT_CRITERIA: RankingCriteria = {
    validationWeight: 0.5,
    confidenceWeight: 0.3,
    simplicityWeight: 0.1,
    executionTimeWeight: 0.1
};

/**
 * Rank patches by multiple criteria
 */
export function rankPatchesByCriteria(
    patches: PatchCandidate[],
    validationResults: Map<string, ValidationResult>,
    criteria: RankingCriteria = DEFAULT_CRITERIA
): RankedPatch[] {

    const rankedPatches: RankedPatch[] = patches.map(patch => {
        const validation = validationResults.get(patch.id);

        // Calculate individual scores
        const validationScore = calculateValidationScore(validation);
        const confidenceScore = patch.confidence;
        const simplicityScore = calculateSimplicityScore(patch);
        const executionTimeScore = calculateExecutionTimeScore(validation);

        // Calculate weighted total score
        const score =
            validationScore * criteria.validationWeight +
            confidenceScore * criteria.confidenceWeight +
            simplicityScore * criteria.simplicityWeight +
            executionTimeScore * criteria.executionTimeWeight;

        return {
            patch,
            validation,
            score,
            rank: 0, // Will be set after sorting
            breakdown: {
                validationScore,
                confidenceScore,
                simplicityScore,
                executionTimeScore
            }
        };
    });

    // Sort by score (descending)
    rankedPatches.sort((a, b) => b.score - a.score);

    // Assign ranks
    rankedPatches.forEach((rp, index) => {
        rp.rank = index + 1;
    });

    return rankedPatches;
}

/**
 * Calculate validation score (0-1)
 */
function calculateValidationScore(validation?: ValidationResult): number {
    if (!validation) return 0;

    let score = 0;

    // Tests passed: 0.6
    if (validation.testsPassed) score += 0.6;

    // Syntax valid: 0.2
    if (validation.syntaxValid) score += 0.2;

    // Static analysis passed: 0.2
    if (validation.staticAnalysisPassed) score += 0.2;

    return score;
}

/**
 * Calculate simplicity score based on code length and strategy
 */
function calculateSimplicityScore(patch: PatchCandidate): number {
    // Prefer direct fixes (simpler)
    const strategyScore = {
        direct: 1.0,
        conservative: 0.8,
        alternative: 0.6,
        aggressive: 0.4
    };

    const baseScore = strategyScore[patch.strategy] || 0.5;

    // Penalize very long patches
    const codeLength = patch.code.length;
    const lengthPenalty = Math.max(0, 1 - (codeLength / 5000));

    return baseScore * (0.7 + 0.3 * lengthPenalty);
}

/**
 * Calculate execution time score (faster is better)
 */
function calculateExecutionTimeScore(validation?: ValidationResult): number {
    if (!validation || !validation.executionTime) return 0.5;

    // Normalize execution time (assume 10s is max acceptable)
    const maxTime = 10000; // 10 seconds in ms
    const normalized = Math.min(validation.executionTime / maxTime, 1);

    // Invert (faster = higher score)
    return 1 - normalized;
}

/**
 * Get the best patch from ranked results
 */
export function getBestPatch(rankedPatches: RankedPatch[]): PatchCandidate | null {
    if (rankedPatches.length === 0) return null;

    // Return the highest ranked patch that passed validation
    const passingPatch = rankedPatches.find(rp => rp.validation?.passed);
    if (passingPatch) return passingPatch.patch;

    // If none passed, return the highest ranked patch
    return rankedPatches[0].patch;
}

/**
 * Filter patches that meet minimum criteria
 */
export function filterViablePatches(
    rankedPatches: RankedPatch[],
    minScore: number = 0.5
): RankedPatch[] {
    return rankedPatches.filter(rp => rp.score >= minScore);
}
