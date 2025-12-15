/**
 * Adaptive Model Selector - Cost-Aware LLM Selection
 * 
 * Implements intelligent model selection based on:
 * - Error complexity
 * - Budget constraints
 * - Historical success rates
 * - Attempt number (retry strategy)
 */

export interface ModelSelectionContext {
    complexity: number;
    category: string;
    attemptNumber: number;
    remainingBudget: number;
    historicalSuccessRate?: number;
}

export class AdaptiveModelSelector {
    private MODEL_SMART = "gemini-3-pro-preview";
    private MODEL_FAST = "gemini-2.5-flash";

    // Cost estimates per 1K tokens (approximate)
    private SMART_COST_PER_1K_TOKENS = 0.01;
    private FAST_COST_PER_1K_TOKENS = 0.001;

    /**
     * Select the optimal model for the given context
     */
    selectModel(ctx: ModelSelectionContext): string {
        // Simple errors always use fast model
        if (ctx.complexity < 4) {
            return this.MODEL_FAST;
        }

        // First attempt on complex errors: use smart model
        if (ctx.attemptNumber === 1 && ctx.complexity > 8) {
            return this.MODEL_SMART;
        }

        // If fast model has high success rate for this category, use it
        if (ctx.historicalSuccessRate && ctx.historicalSuccessRate > 0.7) {
            return this.MODEL_FAST;
        }

        // Budget-constrained: downgrade to fast model
        const estimatedSmartCost = this.SMART_COST_PER_1K_TOKENS * 2; // Estimate 2K tokens
        if (ctx.remainingBudget < estimatedSmartCost) {
            return this.MODEL_FAST;
        }

        // Retry strategy: alternate between models
        if (ctx.attemptNumber > 1) {
            // If we failed with smart model, try fast (maybe hallucination issue)
            // If we failed with fast model, try smart (maybe needs more reasoning)
            return ctx.attemptNumber % 2 === 0 ? this.MODEL_FAST : this.MODEL_SMART;
        }

        // Default to smart model for medium-high complexity
        return ctx.complexity > 6 ? this.MODEL_SMART : this.MODEL_FAST;
    }

    /**
     * Estimate cost for a model given expected token count
     */
    estimateCost(model: string, estimatedTokens: number): number {
        const costPer1K = model.includes('flash')
            ? this.FAST_COST_PER_1K_TOKENS
            : this.SMART_COST_PER_1K_TOKENS;
        return (estimatedTokens / 1000) * costPer1K;
    }

    /**
     * Get model name constants
     */
    getModelSmart(): string {
        return this.MODEL_SMART;
    }

    getModelFast(): string {
        return this.MODEL_FAST;
    }
}
