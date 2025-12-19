import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LearningLoopService } from '../../services/LearningLoopService.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';

describe('Reinforcement Learning Logic Simulation', () => {
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

    it('should converge towards the more successful tool sequence', async () => {
        const category = 'test-category';
        const complexity = 5;

        // Strategy A: 'ls', 'grep' (Low success rate)
        // Strategy B: 'ls', 'edit' (High success rate)

        // Simulate 3 runs for Strategy A (1 success, 2 failures)
        for (let i = 0; i < 3; i++) {
            const runId = `run-A-${i}`;
            await testDb.agentRun.create({ data: { id: runId, groupId: 'G1', status: i === 0 ? 'success' : 'failed', state: '{}' } });
            await service.processRunOutcome(runId, category, complexity, ['ls', 'grep'], {
                success: i === 0,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2
            });
        }

        // Simulate 3 runs for Strategy B (3 successes)
        for (let i = 0; i < 3; i++) {
            const runId = `run-B-${i}`;
            await testDb.agentRun.create({ data: { id: runId, groupId: 'G1', status: 'success', state: '{}' } });
            await service.processRunOutcome(runId, category, complexity, ['ls', 'edit'], {
                success: true,
                llmCost: 0.01,
                totalLatency: 1000,
                llmTokensInput: 100,
                llmTokensOutput: 50,
                toolCallCount: 2
            });
        }

        // Get recommendation
        const recommendation = await service.getStrategyRecommendation(category, complexity);
        
        // Should recommend Strategy B
        expect(recommendation.preferredTools).toEqual(['ls', 'edit']);
        expect(recommendation.historicalStats?.successRate).toBeGreaterThan(0.5);
    });
});
