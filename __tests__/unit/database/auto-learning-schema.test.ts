import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabaseManager } from '../../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';

describe('Auto-Learning Database Schema', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    describe('IngestedData Model', () => {
        it('should store and retrieve ingested data', async () => {
            const data = await testDb.ingestedData.create({
                data: {
                    source: 'benchmark_log.txt',
                    type: 'log',
                    content: 'Some log content',
                    metadata: JSON.stringify({ version: '1.0' })
                }
            });

            expect(data).toHaveProperty('id');
            expect(data.source).toBe('benchmark_log.txt');
            expect(data.type).toBe('log');
            expect(data.content).toBe('Some log content');
            expect(JSON.parse(data.metadata || '{}')).toEqual({ version: '1.0' });
        });
    });

    describe('RewardSignal Model', () => {
        it('should store and retrieve reward signals', async () => {
            // Create a parent AgentRun
            const run = await testDb.agentRun.create({
                data: {
                    id: 'test-run-reward',
                    groupId: 'group-1',
                    status: 'success',
                    state: '{}'
                }
            });

            const signal = await testDb.rewardSignal.create({
                data: {
                    runId: run.id,
                    outcome: 'Pass',
                    reward: 1.0
                }
            });

            expect(signal).toHaveProperty('id');
            expect(signal.runId).toBe(run.id);
            expect(signal.outcome).toBe('Pass');
            expect(signal.reward).toBe(1.0);
        });
    });

    describe('LearningMetric Model', () => {
        it('should store and retrieve learning metrics', async () => {
            const metric = await testDb.learningMetric.create({
                data: {
                    metricName: 'Fix Rate',
                    value: 0.85,
                    metadata: JSON.stringify({ epoch: 1 })
                }
            });

            expect(metric).toHaveProperty('id');
            expect(metric.metricName).toBe('Fix Rate');
            expect(metric.value).toBe(0.85);
            expect(metric).toHaveProperty('timestamp');
        });
    });
});
