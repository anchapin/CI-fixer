/**
 * Integration layer for RepairAgent patch generation
 * Enhances existing fix generation with multi-candidate patches
 */

import { AppConfig } from '../../types.js';
import { generatePatchCandidates, PatchGenerationResult, rankPatches, filterByConfidence } from './patch-generation.js';
import { FaultLocation } from './fault-localization.js';

export interface EnhancedFixResult {
    primaryFix: string;
    alternativeFixes: string[];
    patchDetails?: PatchGenerationResult;
    strategy: 'single' | 'multi-candidate';
}

/**
 * Enhance fix generation with multi-candidate patches
 * This is an optional enhancement layer that can be toggled on/off
 */
export async function enhanceFixGeneration(
    config: AppConfig,
    faultLocation: FaultLocation,
    originalCode: string,
    errorMessage: string,
    repoContext?: string
): Promise<EnhancedFixResult> {

    // Check if multi-candidate generation is enabled
    const enabled = process.env.ENABLE_MULTI_CANDIDATE_PATCHES === 'true';

    if (!enabled) {
        // Fallback to single candidate (existing behavior)
        return {
            primaryFix: originalCode,
            alternativeFixes: [],
            strategy: 'single'
        };
    }

    try {
        // Generate multiple patch candidates
        const patchResult = await generatePatchCandidates(
            config,
            faultLocation,
            originalCode,
            errorMessage,
            repoContext
        );

        // Filter by minimum confidence
        const viableCandidates = filterByConfidence(patchResult.candidates, 0.6);

        if (viableCandidates.length === 0) {
            // No viable candidates, return original
            return {
                primaryFix: originalCode,
                alternativeFixes: [],
                strategy: 'single'
            };
        }

        // Rank candidates
        const rankedCandidates = rankPatches(viableCandidates);

        return {
            primaryFix: rankedCandidates[0].code,
            alternativeFixes: rankedCandidates.slice(1, 3).map(c => c.code),
            patchDetails: patchResult,
            strategy: 'multi-candidate'
        };

    } catch (error) {
        console.error('[PatchGeneration] Enhancement failed:', error);
        // Fallback to original code on error
        return {
            primaryFix: originalCode,
            alternativeFixes: [],
            strategy: 'single'
        };
    }
}

/**
 * Get the best patch from multiple candidates based on validation results
 */
export function selectBestPatch(
    patchResult: PatchGenerationResult,
    validationResults: Map<string, boolean>
): string {

    // Find the first candidate that passed validation
    for (const candidate of patchResult.candidates) {
        if (validationResults.get(candidate.id) === true) {
            return candidate.code;
        }
    }

    // If none passed, return the highest confidence candidate
    return patchResult.primaryCandidate.code;
}
