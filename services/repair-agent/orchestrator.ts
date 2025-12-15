/**
 * RepairAgent Orchestrator
 * Coordinates all RepairAgent components for autonomous program repair
 * Based on RepairAgent paper (arXiv:2403.17134)
 */

import { AppConfig } from '../../types.js';
import { SandboxEnvironment } from '../../sandbox.js';
import { parseStackTrace, localizeFault, FaultLocalizationResult } from './fault-localization.js';
import { generatePatchCandidates, PatchGenerationResult } from './patch-generation.js';
import { validatePatches, ValidationResult } from './patch-validation.js';
import { rankPatchesByCriteria, getBestPatch, RankedPatch } from './patch-ranking.js';
import { iterativeRefinement } from './feedback-loop.js';

export interface RepairAgentConfig {
    enableFaultLocalization: boolean;
    enableMultiCandidates: boolean;
    enableValidation: boolean;
    enableIterativeRefinement: boolean;
    maxCandidates: number;
    maxRefinementIterations: number;
}

export interface RepairAgentResult {
    success: boolean;
    finalPatch: string;
    faultLocalization?: FaultLocalizationResult;
    patchGeneration?: PatchGenerationResult;
    validationResults?: Map<string, ValidationResult>;
    rankedPatches?: RankedPatch[];
    iterations: number;
    executionTime: number;
}

const DEFAULT_CONFIG: RepairAgentConfig = {
    enableFaultLocalization: true,
    enableMultiCandidates: true,
    enableValidation: true,
    enableIterativeRefinement: true,
    maxCandidates: 3,
    maxRefinementIterations: 3
};

/**
 * Main RepairAgent orchestration function
 * Coordinates fault localization, patch generation, validation, and ranking
 */
export async function runRepairAgent(
    config: AppConfig,
    errorLog: string,
    originalCode: string,
    errorMessage: string,
    sandbox: SandboxEnvironment,
    testCommand: string,
    repoContext?: string,
    agentConfig: Partial<RepairAgentConfig> = {}
): Promise<RepairAgentResult> {

    const startTime = Date.now();
    const cfg = { ...DEFAULT_CONFIG, ...agentConfig };

    const result: RepairAgentResult = {
        success: false,
        finalPatch: originalCode,
        iterations: 0,
        executionTime: 0
    };

    try {
        // Step 1: Fault Localization (if enabled)
        let faultLocation;
        if (cfg.enableFaultLocalization) {
            console.log('[RepairAgent] Step 1: Fault Localization');
            const stackTrace = parseStackTrace(errorLog);

            if (stackTrace.length > 0) {
                const faultLocalization = await localizeFault(
                    config,
                    errorLog,
                    stackTrace,
                    repoContext
                );
                result.faultLocalization = faultLocalization;
                faultLocation = faultLocalization.primaryLocation;
                console.log(`[RepairAgent] Fault localized to ${faultLocation.file}:${faultLocation.line} (confidence: ${faultLocation.confidence})`);
            } else {
                console.log('[RepairAgent] No stack trace found, using error message');
                faultLocation = {
                    file: 'unknown',
                    line: 0,
                    confidence: 0.5,
                    reasoning: 'No stack trace available',
                    suggestedFix: errorMessage
                };
            }
        } else {
            faultLocation = {
                file: 'unknown',
                line: 0,
                confidence: 0.5,
                reasoning: 'Fault localization disabled',
                suggestedFix: errorMessage
            };
        }

        // Step 2: Patch Generation (multi-candidate if enabled)
        console.log('[RepairAgent] Step 2: Patch Generation');
        const patchGeneration = await generatePatchCandidates(
            config,
            faultLocation,
            originalCode,
            errorMessage,
            repoContext
        );
        result.patchGeneration = patchGeneration;

        // Limit candidates
        const candidates = patchGeneration.candidates.slice(0, cfg.maxCandidates);
        console.log(`[RepairAgent] Generated ${candidates.length} patch candidates`);

        // Step 3: Validation (if enabled)
        if (cfg.enableValidation) {
            console.log('[RepairAgent] Step 3: Validation');
            const validationResults = await validatePatches(
                config,
                candidates,
                sandbox,
                testCommand
            );
            result.validationResults = validationResults;

            const passedCount = Array.from(validationResults.values()).filter(v => v.passed).length;
            console.log(`[RepairAgent] ${passedCount}/${candidates.length} patches passed validation`);

            // Step 4: Ranking
            console.log('[RepairAgent] Step 4: Ranking');
            const rankedPatches = rankPatchesByCriteria(candidates, validationResults);
            result.rankedPatches = rankedPatches;

            // Step 5: Select best patch
            const bestPatch = getBestPatch(rankedPatches);
            if (bestPatch) {
                result.finalPatch = bestPatch.code;
                result.success = validationResults.get(bestPatch.id)?.passed || false;
                console.log(`[RepairAgent] Selected best patch: ${bestPatch.id} (score: ${rankedPatches[0].score.toFixed(2)})`);
            }

            // Step 6: Iterative Refinement (if needed and enabled)
            if (!result.success && cfg.enableIterativeRefinement && bestPatch) {
                console.log('[RepairAgent] Step 6: Iterative Refinement');
                const refinementResult = await iterativeRefinement(
                    config,
                    bestPatch,
                    async (patch) => {
                        const vr = await validatePatches(config, [patch], sandbox, testCommand);
                        return vr.get(patch.id)!;
                    },
                    cfg.maxRefinementIterations
                );

                result.finalPatch = refinementResult.finalPatch.code;
                result.success = refinementResult.validationResult.passed;
                result.iterations = refinementResult.iterations;
                console.log(`[RepairAgent] Refinement completed after ${refinementResult.iterations} iterations`);
            }

        } else {
            // No validation - just use primary candidate
            result.finalPatch = patchGeneration.primaryCandidate.code;
            result.success = true; // Assume success without validation
            console.log('[RepairAgent] Validation disabled - using primary candidate');
        }

    } catch (error: any) {
        console.error('[RepairAgent] Error:', error);
        result.success = false;
        result.finalPatch = originalCode; // Fallback to original
    }

    result.executionTime = Date.now() - startTime;
    console.log(`[RepairAgent] Completed in ${result.executionTime}ms - Success: ${result.success}`);

    return result;
}

/**
 * Check if RepairAgent is enabled via environment variables
 */
export function isRepairAgentEnabled(): boolean {
    return process.env.ENABLE_REPAIR_AGENT === 'true';
}

/**
 * Get RepairAgent configuration from environment
 */
export function getRepairAgentConfig(): Partial<RepairAgentConfig> {
    return {
        enableFaultLocalization: process.env.ENABLE_FAULT_LOCALIZATION !== 'false',
        enableMultiCandidates: process.env.ENABLE_MULTI_CANDIDATE_PATCHES !== 'false',
        enableValidation: process.env.ENABLE_PATCH_VALIDATION !== 'false',
        enableIterativeRefinement: process.env.ENABLE_ITERATIVE_REFINEMENT !== 'false',
        maxCandidates: parseInt(process.env.MAX_PATCH_CANDIDATES || '3'),
        maxRefinementIterations: parseInt(process.env.MAX_REFINEMENT_ITERATIONS || '3')
    };
}
