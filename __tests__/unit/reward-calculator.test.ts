import { describe, it, expect } from 'vitest';
import { RewardCalculator } from '../../services/orchestration/reward-calculator.js';

describe('RewardCalculator', () => {
    const calc = new RewardCalculator();

    describe('calculateReward', () => {
        it('should give high reward for successful, cheap, fast fixes', () => {
            const reward = calc.calculateReward({
                success: true,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2,
                diffSize: 10
            });

            expect(reward).toBeGreaterThan(90); // Close to 100 (success) minus small penalties
            expect(reward).toBeLessThan(100);
        });

        it('should penalize expensive fixes', () => {
            const reward = calc.calculateReward({
                success: true,
                llmCost: 0.50, // Expensive
                totalLatency: 5000,
                llmTokensInput: 5000,
                llmTokensOutput: 3000,
                toolCallCount: 10,
                diffSize: 100
            });

            expect(reward).toBeLessThan(90); // Success but heavily penalized for cost
            expect(reward).toBeGreaterThan(0); // Still positive because successful
        });

        it('should penalize slow fixes', () => {
            const reward = calc.calculateReward({
                success: true,
                llmCost: 0.01,
                totalLatency: 30000, // 30 seconds
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2
            });

            expect(reward).toBeLessThan(95); // Penalized for latency
        });

        it('should give negative reward for failures', () => {
            const reward = calc.calculateReward({
                success: false,
                llmCost: 0.10,
                totalLatency: 5000,
                llmTokensInput: 1000,
                llmTokensOutput: 500,
                toolCallCount: 3
            });

            expect(reward).toBeLessThan(0); // Negative for failure
        });

        it('should bonus for high code quality', () => {
            const rewardWithQuality = calc.calculateReward({
                success: true,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2,
                codeQuality: 95 // High quality
            });

            const rewardWithoutQuality = calc.calculateReward({
                success: true,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2
            });

            expect(rewardWithQuality).toBeGreaterThan(rewardWithoutQuality);
        });

        it('should penalize large diffs', () => {
            const smallDiff = calc.calculateReward({
                success: true,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2,
                diffSize: 10
            });

            const largeDiff = calc.calculateReward({
                success: true,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2,
                diffSize: 500 // Large diff
            });

            expect(smallDiff).toBeGreaterThan(largeDiff);
        });
    });

    describe('explainReward', () => {
        it('should provide human-readable explanation', () => {
            const explanation = calc.explainReward({
                success: true,
                llmCost: 0.05,
                totalLatency: 2000,
                llmTokensInput: 500,
                llmTokensOutput: 300,
                toolCallCount: 3,
                codeQuality: 85,
                diffSize: 25
            });

            expect(explanation).toContain('Total Reward');
            expect(explanation).toContain('Outcome');
            expect(explanation).toContain('Cost');
            expect(explanation).toContain('Latency');
        });
    });

    describe('setWeights', () => {
        it('should allow weight customization', () => {
            const customCalc = new RewardCalculator();
            customCalc.setWeights({ cost: -40 }); // Double cost penalty

            const reward = customCalc.calculateReward({
                success: true,
                llmCost: 0.10,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2
            });

            // Should be more heavily penalized for cost
            const defaultReward = calc.calculateReward({
                success: true,
                llmCost: 0.10,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2
            });

            expect(reward).toBeLessThan(defaultReward);
        });
    });
});
