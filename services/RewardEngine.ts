import { PrismaClient } from '@prisma/client';
import { RewardCalculator, FixAttemptMetrics } from './orchestration/reward-calculator.js';

export class RewardEngine {
    private calculator: RewardCalculator;

    constructor(private prisma: PrismaClient) {
        this.calculator = new RewardCalculator();
    }

    /**
     * Calculates the reward for a run and persists it to the database.
     * @param runId The ID of the AgentRun
     * @param metrics The metrics from the run
     */
    async recordReward(runId: string, metrics: FixAttemptMetrics) {
        const reward = this.calculator.calculateReward(metrics);
        const outcome = metrics.success ? 'Pass' : 'Fail';

        return await this.prisma.rewardSignal.create({
            data: {
                runId,
                outcome,
                reward
            }
        });
    }

    /**
     * Get the reward calculator instance for tuning or explanations.
     */
    getCalculator() {
        return this.calculator;
    }
}
