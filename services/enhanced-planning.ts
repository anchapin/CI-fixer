/**
 * Enhanced Planning Service
 * Integrates all research features: semantic search, enhanced KB, Thompson sampling
 */

import { SemanticSearchService } from './semantic-search/search-service.js';
import { EnhancedKnowledgeBase, ErrorPattern } from './knowledge-base/enhanced-kb.js';
import { ThompsonSamplingRefiner, calculateAdaptiveLimit } from './iterative-refinement/thompson-sampling.js';
import { SandboxEnvironment } from '../sandbox.js';

// Global instances
const semanticSearch = new SemanticSearchService();
const enhancedKB = new EnhancedKnowledgeBase();
const thompsonRefiner = new ThompsonSamplingRefiner();

/**
 * Enhanced file search using semantic embeddings
 */
export async function enhancedFileSearch(
    query: string,
    sandbox: SandboxEnvironment | undefined,
    topK: number = 5
): Promise<Array<{ file: string; score: number }>> {

    if (!sandbox) {
        return [];
    }

    try {
        // Index repository files if not already done
        const files = await sandbox.listFiles();
        if (files.size > 0) {
            await semanticSearch.indexFiles(files);
            console.log(`[SemanticSearch] Indexed ${files.size} files`);
        }

        // Perform semantic search
        const results = semanticSearch.search(query, topK);
        console.log(`[SemanticSearch] Found ${results.length} relevant files`);

        return results;
    } catch (error) {
        console.warn('[SemanticSearch] Failed:', error);
        return [];
    }
}

/**
 * Retrieve fix patterns from enhanced knowledge base
 */
export function retrieveFixPatterns(
    errorMessage: string,
    errorType: string,
    language: string = 'typescript',
    topK: number = 3
): Array<{ pattern: ErrorPattern; score: number; reasoning: string }> {

    try {
        const results = enhancedKB.retrieveFixPatterns(errorMessage, errorType, language, topK);

        if (results.length > 0) {
            console.log(`[EnhancedKB] Retrieved ${results.length} fix patterns (best score: ${results[0].score.toFixed(2)})`);
        }

        return results;
    } catch (error) {
        console.warn('[EnhancedKB] Failed:', error);
        return [];
    }
}

/**
 * Record successful fix for learning
 */
export function recordSuccessfulFix(
    errorType: string,
    errorMessage: string,
    fixPattern: string,
    context: string
): void {
    try {
        enhancedKB.addPattern({
            id: `fix-${Date.now()}`,
            errorType,
            errorMessage,
            context,
            fixPattern,
            metadata: {
                language: 'typescript',
                frequency: 1,
                successRate: 1.0,
                lastUsed: Date.now()
            }
        });
        console.log(`[EnhancedKB] Recorded successful fix for ${errorType}`);
    } catch (error) {
        console.warn('[EnhancedKB] Failed to record fix:', error);
    }
}

/**
 * Calculate adaptive iteration limit using Thompson Sampling
 */
export function getAdaptiveIterationLimit(
    baseLimit: number,
    complexity: number,
    successHistory: boolean[],
    budget: number
): { limit: number; decision: any } {

    try {
        const successRate = successHistory.length > 0
            ? successHistory.filter(s => s).length / successHistory.length
            : 0.5;

        const adaptiveLimit = calculateAdaptiveLimit(baseLimit, complexity, successRate, budget);

        const decision = thompsonRefiner.decideIteration({
            currentIteration: 0,
            maxIterations: adaptiveLimit,
            successHistory,
            costSoFar: 0,
            maxCost: budget
        });

        console.log(`[ThompsonSampling] Adaptive limit: ${adaptiveLimit} (${decision.reasoning})`);

        return { limit: adaptiveLimit, decision };
    } catch (error) {
        console.warn('[ThompsonSampling] Failed, using base limit:', error);
        return { limit: baseLimit, decision: null };
    }
}

/**
 * Update Thompson Sampling based on iteration outcome
 */
export function updateIterationOutcome(success: boolean): void {
    try {
        const armId = success ? 'continue' : 'terminate';
        thompsonRefiner.updateArm(armId, success);
        console.log(`[ThompsonSampling] Updated ${armId} arm (success: ${success})`);
    } catch (error) {
        console.warn('[ThompsonSampling] Failed to update:', error);
    }
}

/**
 * Get all enhancement statistics
 */
export function getEnhancementStats(): {
    semanticSearch: any;
    enhancedKB: any;
    thompsonSampling: any;
} {
    return {
        semanticSearch: semanticSearch.getStats(),
        enhancedKB: enhancedKB.getStats(),
        thompsonSampling: thompsonRefiner.getStats()
    };
}
