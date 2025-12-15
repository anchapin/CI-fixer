/**
 * Iterative Refinement Module
 * Implements Thompson Sampling for adaptive iteration limits
 * Based on "Iterative Refinement as Bandit Problem" research
 */

export interface IterationArm {
    id: string;
    strategy: 'continue' | 'terminate' | 'refine' | 'explore';
    alpha: number;  // Beta distribution parameter (successes + 1)
    beta: number;   // Beta distribution parameter (failures + 1)
}

export interface IterationDecision {
    action: 'continue' | 'terminate';
    confidence: number;
    reasoning: string;
    expectedReward: number;
}

export interface IterationContext {
    currentIteration: number;
    maxIterations: number;
    successHistory: boolean[];
    costSoFar: number;
    maxCost: number;
}

/**
 * Thompson Sampling for Iterative Refinement
 */
export class ThompsonSamplingRefiner {
    private arms: Map<string, IterationArm> = new Map();

    constructor() {
        // Initialize arms with prior
        this.arms.set('continue', { id: 'continue', strategy: 'continue', alpha: 1, beta: 1 });
        this.arms.set('terminate', { id: 'terminate', strategy: 'terminate', alpha: 1, beta: 1 });
        this.arms.set('refine', { id: 'refine', strategy: 'refine', alpha: 1, beta: 1 });
        this.arms.set('explore', { id: 'explore', strategy: 'explore', alpha: 1, beta: 1 });
    }

    /**
     * Decide whether to continue or terminate iteration
     */
    decideIteration(context: IterationContext): IterationDecision {
        // Hard limits
        if (context.currentIteration >= context.maxIterations) {
            return {
                action: 'terminate',
                confidence: 1.0,
                reasoning: 'Maximum iterations reached',
                expectedReward: 0
            };
        }

        if (context.costSoFar >= context.maxCost) {
            return {
                action: 'terminate',
                confidence: 1.0,
                reasoning: 'Maximum cost exceeded',
                expectedReward: 0
            };
        }

        // Calculate success rate
        const successRate = context.successHistory.length > 0
            ? context.successHistory.filter(s => s).length / context.successHistory.length
            : 0.5;

        // Sample from Thompson Sampling
        const continueArm = this.arms.get('continue')!;
        const terminateArm = this.arms.get('terminate')!;

        const continueSample = this.sampleBeta(continueArm.alpha, continueArm.beta);
        const terminateSample = this.sampleBeta(terminateArm.alpha, terminateArm.beta);

        // Calculate expected reward
        const remainingIterations = context.maxIterations - context.currentIteration;
        const remainingBudget = context.maxCost - context.costSoFar;

        const continueReward = continueSample * successRate * remainingIterations;
        const terminateReward = terminateSample * (1 - successRate);

        // Decide based on expected reward
        if (continueReward > terminateReward && remainingBudget > 0) {
            return {
                action: 'continue',
                confidence: continueSample,
                reasoning: `Expected reward: ${continueReward.toFixed(2)} > ${terminateReward.toFixed(2)}`,
                expectedReward: continueReward
            };
        } else {
            return {
                action: 'terminate',
                confidence: terminateSample,
                reasoning: `Expected reward: ${terminateReward.toFixed(2)} >= ${continueReward.toFixed(2)}`,
                expectedReward: terminateReward
            };
        }
    }

    /**
     * Update arm statistics based on outcome
     */
    updateArm(armId: string, success: boolean): void {
        const arm = this.arms.get(armId);
        if (arm) {
            if (success) {
                arm.alpha += 1;
            } else {
                arm.beta += 1;
            }
        }
    }

    /**
     * Get statistics for all arms
     */
    getStats(): Record<string, { alpha: number; beta: number; mean: number }> {
        const stats: Record<string, { alpha: number; beta: number; mean: number }> = {};

        for (const [id, arm] of this.arms) {
            stats[id] = {
                alpha: arm.alpha,
                beta: arm.beta,
                mean: arm.alpha / (arm.alpha + arm.beta)
            };
        }

        return stats;
    }

    // Private helper methods

    /**
     * Sample from Beta distribution using Gamma distribution
     */
    private sampleBeta(alpha: number, beta: number): number {
        const x = this.sampleGamma(alpha);
        const y = this.sampleGamma(beta);
        return x / (x + y);
    }

    /**
     * Sample from Gamma distribution using Marsaglia and Tsang method
     */
    private sampleGamma(shape: number): number {
        if (shape < 1) {
            // Use transformation for shape < 1
            return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
        }

        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);

        while (true) {
            let x, v;
            do {
                x = this.sampleNormal();
                v = 1 + c * x;
            } while (v <= 0);

            v = v * v * v;
            const u = Math.random();

            if (u < 1 - 0.0331 * x * x * x * x) {
                return d * v;
            }

            if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
                return d * v;
            }
        }
    }

    /**
     * Sample from standard normal distribution using Box-Muller transform
     */
    private sampleNormal(): number {
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}

/**
 * Adaptive iteration limit calculator
 */
export function calculateAdaptiveLimit(
    baseLimit: number,
    complexity: number,
    successRate: number,
    budget: number
): number {
    // Adjust based on complexity (1-10 scale)
    const complexityFactor = 0.5 + (complexity / 10) * 0.5; // 0.5 to 1.0

    // Adjust based on success rate
    const successFactor = successRate > 0.5 ? 1.2 : 0.8;

    // Adjust based on remaining budget
    const budgetFactor = Math.min(1.5, budget / 1000); // Cap at 1.5x

    const adaptiveLimit = Math.floor(
        baseLimit * complexityFactor * successFactor * budgetFactor
    );

    return Math.max(3, Math.min(15, adaptiveLimit)); // Clamp between 3 and 15
}

/**
 * Global Thompson Sampling refiner instance
 */
let globalRefiner: ThompsonSamplingRefiner | null = null;

export function getThompsonRefiner(): ThompsonSamplingRefiner {
    if (!globalRefiner) {
        globalRefiner = new ThompsonSamplingRefiner();
    }
    return globalRefiner;
}
