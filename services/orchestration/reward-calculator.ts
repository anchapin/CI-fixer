/**
 * Reward Calculator - Multi-Objective Optimization
 * 
 * Calculates composite reward scores based on:
 * - Outcome (success/failure)
 * - Efficiency (cost and latency)
 * - Quality (code quality, diff size)
 */

export interface FixAttemptMetrics {
    success: boolean;
    llmCost: number;
    totalLatency: number;
    llmTokensInput: number;
    llmTokensOutput: number;
    toolCallCount: number;
    codeQuality?: number;      // 0-100
    diffSize?: number;         // Lines changed
}

export class RewardCalculator {
    // Weights tuned for CI-Fixer priorities
    // These can be adjusted based on user preferences or learned from data
    private weights = {
        success: 100,           // Success is most important
        cost: -20,              // $0.10 = -2 point (Increased from -1)
        latency: -0.02,         // 100ms = -0.02 point (Increased from -0.01)
        quality: 5,             // Code quality bonus
        simplicity: 2           // Prefer smaller diffs
    };

    /**
     * Calculate composite reward score
     * 
     * Higher scores are better. Typical ranges:
     * - Successful, efficient fix: 90-100
     * - Successful but expensive: 50-90
     * - Failed attempt: -50 to 0
     */
    calculateReward(metrics: FixAttemptMetrics): number {
        // Outcome reward: large positive for success, large negative for failure
        const outcomeReward = metrics.success ? this.weights.success : -50;

        // Efficiency reward: penalize high cost and latency
        const costPenalty = this.weights.cost * metrics.llmCost;
        const latencyPenalty = this.weights.latency * (metrics.totalLatency / 100); // Convert to 100ms units
        const efficiencyReward = costPenalty + latencyPenalty;

        // Quality reward: bonus for high code quality
        const qualityReward = metrics.codeQuality
            ? (this.weights.quality * metrics.codeQuality / 100)
            : 0;

        // Simplicity reward: prefer smaller diffs (negative penalty for large diffs)
        const simplicityReward = metrics.diffSize
            ? -(this.weights.simplicity * Math.min(metrics.diffSize / 100, 5)) // Cap at 5 points penalty
            : 0;

        const totalReward = outcomeReward + efficiencyReward + qualityReward + simplicityReward;

        return Math.round(totalReward * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Get a human-readable explanation of the reward
     */
    explainReward(metrics: FixAttemptMetrics): string {
        const reward = this.calculateReward(metrics);
        const parts: string[] = [];

        parts.push(`Total Reward: ${reward.toFixed(2)}`);
        parts.push(`  Outcome: ${metrics.success ? '+100' : '-50'} (${metrics.success ? 'success' : 'failure'})`);
        parts.push(`  Cost: ${(this.weights.cost * metrics.llmCost).toFixed(2)} ($${metrics.llmCost.toFixed(4)})`);
        parts.push(`  Latency: ${(this.weights.latency * metrics.totalLatency / 100).toFixed(2)} (${metrics.totalLatency}ms)`);

        if (metrics.codeQuality) {
            parts.push(`  Quality: +${(this.weights.quality * metrics.codeQuality / 100).toFixed(2)} (${metrics.codeQuality}/100)`);
        }

        if (metrics.diffSize) {
            parts.push(`  Simplicity: ${(-(this.weights.simplicity * Math.min(metrics.diffSize / 100, 5))).toFixed(2)} (${metrics.diffSize} lines)`);
        }

        return parts.join('\n');
    }

    /**
     * Update weights (for future learning/tuning)
     */
    setWeights(weights: Partial<typeof this.weights>): void {
        this.weights = { ...this.weights, ...weights };
    }
}
