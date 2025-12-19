import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RewardEngine } from '../../services/RewardEngine.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';

describe('RewardEngine', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let engine: RewardEngine;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        engine = new RewardEngine(testDb);
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    it('should calculate and persist reward signal for a success run', async () => {
        // Create AgentRun
        const run = await testDb.agentRun.create({
            data: {
                id: 'run-success',
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
            toolCallCount: 3
        };

        const signal = await engine.recordReward(run.id, metrics);

        expect(signal.reward).toBeGreaterThan(0);
        expect(signal.outcome).toBe('Pass');
        expect(signal.runId).toBe(run.id);

        // Verify in DB
        const dbSignal = await testDb.rewardSignal.findUnique({
            where: { id: signal.id }
        });
        expect(dbSignal).toBeDefined();
        expect(dbSignal?.reward).toBe(signal.reward);
    });

    it('should calculate and persist reward signal for a failed run', async () => {
        const run = await testDb.agentRun.create({
            data: {
                id: 'run-fail',
                groupId: 'group-1',
                status: 'failed',
                state: '{}'
            }
        });

        const metrics = {
            success: false,
            llmCost: 0.05,
            totalLatency: 10000,
            llmTokensInput: 2000,
            llmTokensOutput: 100,
            toolCallCount: 1
        };

        const signal = await engine.recordReward(run.id, metrics);

        expect(signal.reward).toBeLessThan(0);
        expect(signal.outcome).toBe('Fail');
    });

    it('should return the calculator instance', () => {
        const calculator = engine.getCalculator();
        expect(calculator).toBeDefined();
        expect(typeof calculator.calculateReward).toBe('function');
    });
});
