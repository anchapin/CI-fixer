import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordFixAttempt, recordAgentMetrics, getMetricsSummary, getMetricsByCategory } from '../../services/metrics.js';
import { db } from '../../db/client.js';

// Mock Prisma
vi.mock('../../db/client.js', () => ({
    db: {
        fixAttempt: {
            create: vi.fn()
        },
        agentMetrics: {
            create: vi.fn(),
            findMany: vi.fn()
        }
    }
}));

describe('Metrics Collection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('recordFixAttempt', () => {
        it('should record a fix attempt with correct data', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 'test-id' });
            (db.fixAttempt.create as any) = mockCreate;

            await recordFixAttempt('run-123', 1, 'edit', true, 5000, ['src/app.ts']);

            expect(mockCreate).toHaveBeenCalledWith({
                data: {
                    runId: 'run-123',
                    iteration: 1,
                    action: 'edit',
                    success: true,
                    durationMs: 5000,
                    filesChanged: JSON.stringify(['src/app.ts'])
                }
            });
        });

        it('should handle command actions', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 'test-id' });
            (db.fixAttempt.create as any) = mockCreate;

            await recordFixAttempt('run-456', 0, 'command', false, 1200, []);

            expect(mockCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'command',
                    success: false,
                    filesChanged: JSON.stringify([])
                })
            });
        });
    });

    describe('recordAgentMetrics', () => {
        it('should record success with 1.0 success rate', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 'test-id' });
            (db.agentMetrics.create as any) = mockCreate;

            await recordAgentMetrics('run-123', 'success', 3, 15000, 'syntax');

            expect(mockCreate).toHaveBeenCalledWith({
                data: {
                    runId: 'run-123',
                    successRate: 1.0,
                    iterationCount: 3,
                    timeToFixMs: 15000,
                    errorCategory: 'syntax'
                }
            });
        });

        it('should record failure with 0.0 success rate', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 'test-id' });
            (db.agentMetrics.create as any) = mockCreate;

            await recordAgentMetrics('run-456', 'failed', 5, 30000, 'dependency');

            expect(mockCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    successRate: 0.0,
                    iterationCount: 5
                })
            });
        });

        it('should record partial with 0.5 success rate', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 'test-id' });
            (db.agentMetrics.create as any) = mockCreate;

            await recordAgentMetrics('run-789', 'partial', 4, 20000, 'runtime');

            expect(mockCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    successRate: 0.5
                })
            });
        });
    });

    describe('getMetricsSummary', () => {
        it('should return empty summary when no metrics exist', async () => {
            (db.agentMetrics.findMany as any) = vi.fn().mockResolvedValue([]);

            const summary = await getMetricsSummary();

            expect(summary).toEqual({
                totalRuns: 0,
                successRate: 0,
                avgIterations: 0,
                avgTimeToFixMs: 0,
                byCategory: {}
            });
        });

        it('should calculate correct averages', async () => {
            const mockMetrics = [
                { successRate: 1.0, iterationCount: 2, timeToFixMs: 10000, errorCategory: 'syntax' },
                { successRate: 0.0, iterationCount: 5, timeToFixMs: 25000, errorCategory: 'syntax' },
                { successRate: 1.0, iterationCount: 3, timeToFixMs: 15000, errorCategory: 'dependency' }
            ];
            (db.agentMetrics.findMany as any) = vi.fn().mockResolvedValue(mockMetrics);

            const summary = await getMetricsSummary();

            expect(summary.totalRuns).toBe(3);
            expect(summary.successRate).toBeCloseTo(0.667, 2);
            expect(summary.avgIterations).toBeCloseTo(3.333, 2);
            expect(summary.avgTimeToFixMs).toBeCloseTo(16666.67, 2);
        });

        it('should group metrics by category', async () => {
            const mockMetrics = [
                { successRate: 1.0, iterationCount: 2, timeToFixMs: 10000, errorCategory: 'syntax' },
                { successRate: 1.0, iterationCount: 3, timeToFixMs: 15000, errorCategory: 'syntax' },
                { successRate: 0.0, iterationCount: 5, timeToFixMs: 25000, errorCategory: 'dependency' }
            ];
            (db.agentMetrics.findMany as any) = vi.fn().mockResolvedValue(mockMetrics);

            const summary = await getMetricsSummary();

            expect(summary.byCategory['syntax']).toEqual({
                count: 2,
                successRate: 1.0,
                avgIterations: 2.5
            });
            expect(summary.byCategory['dependency']).toEqual({
                count: 1,
                successRate: 0.0,
                avgIterations: 5
            });
        });
    });

    describe('getMetricsByCategory', () => {
        it('should return null for category with no metrics', async () => {
            (db.agentMetrics.findMany as any) = vi.fn().mockResolvedValue([]);

            const result = await getMetricsByCategory('nonexistent');

            expect(result).toBeNull();
        });

        it('should calculate category-specific metrics', async () => {
            const mockMetrics = [
                { successRate: 1.0, iterationCount: 2, timeToFixMs: 10000, errorCategory: 'syntax' },
                { successRate: 0.5, iterationCount: 4, timeToFixMs: 20000, errorCategory: 'syntax' }
            ];
            (db.agentMetrics.findMany as any) = vi.fn().mockResolvedValue(mockMetrics);

            const result = await getMetricsByCategory('syntax', 10);

            expect(result).toEqual({
                category: 'syntax',
                count: 2,
                successRate: 0.75,
                avgIterations: 3,
                avgTimeToFixMs: 15000
            });
        });

        it('should respect limit parameter', async () => {
            const mockFindMany = vi.fn().mockResolvedValue([
                { successRate: 1.0, iterationCount: 2, timeToFixMs: 10000, errorCategory: 'syntax' }
            ]);
            (db.agentMetrics.findMany as any) = mockFindMany;

            await getMetricsByCategory('syntax', 5);

            expect(mockFindMany).toHaveBeenCalledWith({
                where: { errorCategory: 'syntax' },
                orderBy: { createdAt: 'desc' },
                take: 5
            });
        });
    });
});
