import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LearningMetricService } from '../../services/LearningMetricService.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';

describe('LearningMetricService', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let service: LearningMetricService;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        service = new LearningMetricService(testDb);
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    it('should record and retrieve a learning metric', async () => {
        await service.recordMetric('Fix Rate', 0.75, { epoch: 1 });
        
        const metrics = await service.getMetrics('Fix Rate');
        expect(metrics.length).toBe(1);
        expect(metrics[0].value).toBe(0.75);
        expect(JSON.parse(metrics[0].metadata || '{}')).toEqual({ epoch: 1 });
    });

    it('should calculate the average of recent metric values', async () => {
        await service.recordMetric('Accuracy', 0.6);
        await service.recordMetric('Accuracy', 0.8);
        await service.recordMetric('Accuracy', 1.0);

        const avg = await service.getAverageMetricValue('Accuracy', 3);
        expect(avg).toBeCloseTo(0.8);
    });
});
