import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LearningLoopService } from '../../services/LearningLoopService.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';

describe('LearningLoopService', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let service: LearningLoopService;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        service = new LearningLoopService(testDb);
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    it('should process a completed run and update learning state', async () => {
        // Create AgentRun
        const run = await testDb.agentRun.create({
            data: {
                id: 'run-rl-1',
                groupId: 'group-1',
                status: 'success',
                state: '{}'
            }
        });

        const metrics = {
            success: true,
            llmCost: 0.01,
            totalLatency: 5000,
            llmTokensInput: 1000,
            llmTokensOutput: 500,
            toolCallCount: 2,
            diffSize: 10
        };

        const result = await service.processRunOutcome(run.id, 'syntax', 3, ['ls', 'edit'], metrics);

        expect(result.reward).toBeGreaterThan(0);
        
        // Verify RewardSignal created
        const signals = await testDb.rewardSignal.findMany({ where: { runId: run.id } });
        expect(signals.length).toBe(1);

        // Verify Trajectory updated/created
        const trajectories = await testDb.fixTrajectory.findMany({ where: { errorCategory: 'syntax' } });
        expect(trajectories.length).toBe(1);
        expect(trajectories[0].success).toBe(true);
    });

    it('should provide strategy refinement based on historical rewards', async () => {
        // Seed some high reward trajectories for 'dependency'
        await testDb.fixTrajectory.create({
            data: {
                errorCategory: 'dependency',
                complexity: 5,
                toolSequence: JSON.stringify(['ls', 'edit']),
                success: true,
                totalCost: 0.01,
                totalLatency: 1000,
                reward: 95
            }
        });

        const recommendation = await service.getStrategyRecommendation('dependency', 5);
        expect(recommendation.preferredTools).toEqual(['ls', 'edit']);
    });
});
