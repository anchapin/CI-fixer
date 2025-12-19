import { PrismaClient } from '@prisma/client';
import { RewardEngine } from './RewardEngine.js';
import { TrajectoryAnalyzer } from './analytics/trajectory-analyzer.js';
import { FixAttemptMetrics } from './orchestration/reward-calculator.js';
import { CIFixerTool } from './orchestration/tool-types.js';

export class LearningLoopService {
    private rewardEngine: RewardEngine;
    private trajectoryAnalyzer: TrajectoryAnalyzer;

    constructor(private prisma: PrismaClient) {
        this.rewardEngine = new RewardEngine(prisma);
        this.trajectoryAnalyzer = new TrajectoryAnalyzer(prisma);
    }

    /**
     * Processes the outcome of an agent run, recording rewards and updating trajectories.
     */
    async processRunOutcome(
        runId: string,
        category: string,
        complexity: number,
        tools: string[],
        metrics: FixAttemptMetrics
    ) {
        // 1. Record Reward Signal
        const signal = await this.rewardEngine.recordReward(runId, metrics);

        // 2. Update Trajectory for Learning
        await this.trajectoryAnalyzer.recordTrajectory(
            category,
            complexity,
            tools as CIFixerTool[],
            metrics.success,
            metrics.llmCost,
            metrics.totalLatency,
            signal.reward
        );

        return signal;
    }

    /**
     * Provides strategy recommendations based on historical learning.
     */
    async getStrategyRecommendation(category: string, complexity: number) {
        const preferredTools = await this.trajectoryAnalyzer.findOptimalPath(category, complexity);
        const stats = await this.trajectoryAnalyzer.getStats(category);

        return {
            preferredTools,
            historicalStats: stats
        };
    }
}
