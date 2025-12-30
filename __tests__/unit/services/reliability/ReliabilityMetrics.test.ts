/**
 * Unit Tests: ReliabilityMetrics Service
 *
 * Tests the metrics aggregation and analysis functionality for reliability layer telemetry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReliabilityMetrics } from '../../../../services/reliability/ReliabilityMetrics.js';
import { ReliabilityTelemetry } from '../../../../services/reliability/ReliabilityTelemetry.js';

// Mock Prisma Client with proper implementation
const mockPrismaClient = {
    reliabilityEvent: {
        findMany: vi.fn(),
        count: vi.fn(),
    },
};

vi.mock('@prisma/client', () => ({
    PrismaClient: class {
        constructor() {
            return mockPrismaClient;
        }
    },
}));

describe('ReliabilityMetrics', () => {
    let metrics: ReliabilityMetrics;
    let mockTelemetry: ReliabilityTelemetry;

    beforeEach(() => {
        vi.clearAllMocks();
        mockTelemetry = new ReliabilityTelemetry(mockPrismaClient as any);
        metrics = new ReliabilityMetrics(mockPrismaClient as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getLayerMetrics', () => {
        it('should calculate comprehensive metrics for a layer', async () => {
            const mockEvents = [
                {
                    id: 'event-1',
                    triggered: true,
                    recoveryAttempted: true,
                    recoverySuccess: true,
                    threshold: 15,
                },
                {
                    id: 'event-2',
                    triggered: true,
                    recoveryAttempted: true,
                    recoverySuccess: false,
                    threshold: 15,
                },
                {
                    id: 'event-3',
                    triggered: false,
                    recoveryAttempted: false,
                    recoverySuccess: undefined,
                    threshold: 15,
                },
                {
                    id: 'event-4',
                    triggered: true,
                    recoveryAttempted: true,
                    recoverySuccess: true,
                    threshold: 15,
                },
            ];

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.getLayerMetrics('phase2-reproduction');

            expect(result).toEqual({
                layer: 'phase2-reproduction',
                totalEvents: 4,
                triggeredEvents: 3,
                triggerRate: 0.75,
                recoveryAttempts: 3,
                recoverySuccesses: 2,
                recoverySuccessRate: 2 / 3,
                avgThreshold: 15,
            });
        });

        it('should return null when no events exist', async () => {
            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue([]);

            const result = await metrics.getLayerMetrics('phase3-loop-detection');

            expect(result).toBeNull();
        });

        it('should filter by date when since is provided', async () => {
            const since = new Date('2025-01-01');
            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue([
                { id: 'event-1', triggered: true, recoveryAttempted: false, threshold: 15 },
            ]);

            await metrics.getLayerMetrics('phase2-reproduction', since);

            expect(mockPrismaClient.reliabilityEvent.findMany).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    layer: 'phase2-reproduction',
                    createdAt: { gte: since },
                }),
                orderBy: { createdAt: 'desc' },
            });
        });

        it('should handle errors gracefully', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrismaClient.reliabilityEvent.findMany.mockRejectedValue(new Error('Database error'));

            const result = await metrics.getLayerMetrics('phase2-reproduction');

            expect(result).toBeNull();
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('analyzeThreshold', () => {
        it('should recommend no change with insufficient data', async () => {
            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue([]);

            const result = await metrics.analyzeThreshold('phase2-reproduction', 15, 10, 25, 30);

            expect(result).toEqual({
                currentThreshold: 15,
                recommendedThreshold: 15,
                confidence: 0,
                reasoning: 'Insufficient data (0 events, need 30)',
                dataPoints: 0,
            });
        });

        it('should recommend decreasing threshold when layer never triggers', async () => {
            const mockEvents = Array.from({ length: 35 }, (_, i) => ({
                id: `event-${i}`,
                triggered: false,
                recoverySuccess: undefined,
            }));

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.analyzeThreshold('phase2-reproduction', 15, 10, 25, 30);

            expect(result).toEqual({
                currentThreshold: 15,
                recommendedThreshold: 14, // max(10, 15 - 1)
                confidence: 0.5,
                reasoning: expect.stringContaining('has not triggered recently'),
                dataPoints: 35,
            });
        });

        it('should recommend increasing threshold when recovery rate high with high trigger rate', async () => {
            // High recovery rate (80%) + high trigger rate (40%) = threshold too sensitive
            const mockEvents = [
                ...Array.from({ length: 40 }, (_, i) => ({
                    id: `event-${i}`,
                    triggered: i < 16, // 16 triggered out of 40 = 40% trigger rate
                    recoverySuccess: i < 12, // 12 successes out of 16 attempts = 75% recovery
                })),
            ];

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.analyzeThreshold('phase2-reproduction', 15, 10, 25, 30);

            expect(result).toEqual({
                currentThreshold: 15,
                recommendedThreshold: 15 + Math.ceil((0.4 - 0.3) * 10), // 16
                confidence: 0.7,
                reasoning: expect.stringContaining('may be too sensitive'),
                dataPoints: 40,
            });
        });

        it('should recommend decreasing threshold when recovery rate low with high trigger rate', async () => {
            // Low recovery rate (20%) + high trigger rate (30%) = threshold too aggressive
            const mockEvents = Array.from({ length: 40 }, (_, i) => ({
                id: `event-${i}`,
                triggered: i < 12, // 12 triggered out of 40 = 30% trigger rate
                recoverySuccess: i < 2, // 2 successes out of 12 = 16.7% recovery
            }));

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.analyzeThreshold('phase3-loop-detection', 15, 10, 25, 30);

            expect(result).toEqual({
                currentThreshold: 15,
                recommendedThreshold: 15 - Math.ceil((1 - 0.2) * 2), // 15 - 2 = 13
                confidence: 0.8,
                reasoning: expect.stringContaining('may be too aggressive'),
                dataPoints: 40,
            });
        });

        it('should recommend decreasing threshold when trigger rate very low', async () => {
            const mockEvents = Array.from({ length: 40 }, (_, i) => ({
                id: `event-${i}`,
                triggered: i < 2, // 2 triggered out of 40 = 5% trigger rate
                recoverySuccess: false,
            }));

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.analyzeThreshold('phase2-reproduction', 15, 10, 25, 30);

            expect(result).toEqual({
                currentThreshold: 15,
                recommendedThreshold: 14,
                confidence: 0.6,
                reasoning: expect.stringContaining('too conservative'),
                dataPoints: 40,
            });
        });

        it('should recommend no change when balanced', async () => {
            const mockEvents = Array.from({ length: 40 }, (_, i) => ({
                id: `event-${i}`,
                triggered: i < 10, // 25% trigger rate
                recoverySuccess: i < 7, // 70% recovery rate
            }));

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.analyzeThreshold('phase3-loop-detection', 15, 10, 25, 30);

            expect(result).toEqual({
                currentThreshold: 15,
                recommendedThreshold: 15,
                confidence: 0.9,
                reasoning: expect.stringContaining('No change recommended'),
                dataPoints: 40,
            });
        });

        it('should clamp recommended threshold to min/max bounds', async () => {
            const mockEvents = Array.from({ length: 40 }, (_, i) => ({
                id: `event-${i}`,
                triggered: i < 20, // 50% trigger rate
                recoverySuccess: true, // 100% recovery
            }));

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.analyzeThreshold('phase2-reproduction', 15, 12, 18, 30);

            // Should be clamped to max of 18
            expect(result.recommendedThreshold).toBeLessThanOrEqual(18);
        });
    });

    describe('getThresholdTrend', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-01-15T00:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return time-series data for threshold trends', async () => {
            const mockEvents = [
                { id: 'event-1', triggered: true, recoverySuccess: true },
                { id: 'event-2', triggered: false },
            ];

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.getThresholdTrend('phase2-reproduction', 7);

            expect(result).toHaveLength(7);
            expect(mockPrismaClient.reliabilityEvent.findMany).toHaveBeenCalledTimes(7);
        });

        it('should skip days with no events', async () => {
            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue([]);

            const result = await metrics.getThresholdTrend('phase3-loop-detection', 3);

            expect(result).toHaveLength(0);
        });

        it('should handle errors gracefully', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrismaClient.reliabilityEvent.findMany.mockRejectedValue(new Error('Database error'));

            const result = await metrics.getThresholdTrend('phase2-reproduction', 7);

            expect(result).toEqual([]);
            consoleErrorSpy.mockRestore();
        });
    });

    describe('getTopStrategies', () => {
        it('should return strategies sorted by success rate', async () => {
            const mockEvents = [
                { recoveryStrategy: 'reduce-scope', recoverySuccess: true },
                { recoveryStrategy: 'reduce-scope', recoverySuccess: true },
                { recoveryStrategy: 'reduce-scope', recoverySuccess: false }, // 66.7%
                { recoveryStrategy: 'switch-mode', recoverySuccess: true },
                { recoveryStrategy: 'switch-mode', recoverySuccess: false }, // 50%
                { recoveryStrategy: 'regenerate', recoverySuccess: false }, // 0%
            ];

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.getTopStrategies('phase3-loop-detection', 5);

            expect(result).toEqual([
                { strategy: 'reduce-scope', successRate: 2/3, attempts: 3 },
                { strategy: 'switch-mode', successRate: 0.5, attempts: 2 },
                { strategy: 'regenerate', successRate: 0, attempts: 1 },
            ]);
        });

        it('should limit results to specified limit', async () => {
            const mockEvents = [
                { recoveryStrategy: 'strategy-1', recoverySuccess: true },
                { recoveryStrategy: 'strategy-2', recoverySuccess: true },
                { recoveryStrategy: 'strategy-3', recoverySuccess: true },
            ];

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const result = await metrics.getTopStrategies('phase2-reproduction', 2);

            expect(result).toHaveLength(2);
        });

        it('should filter by layer and recovery attempted', async () => {
            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue([]);

            await metrics.getTopStrategies('phase3-loop-detection', 5);

            expect(mockPrismaClient.reliabilityEvent.findMany).toHaveBeenCalledWith({
                where: {
                    layer: 'phase3-loop-detection',
                    recoveryAttempted: true,
                    recoveryStrategy: { not: null },
                },
                orderBy: { createdAt: 'desc' },
            });
        });

        it('should handle errors gracefully', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrismaClient.reliabilityEvent.findMany.mockRejectedValue(new Error('Database error'));

            const result = await metrics.getTopStrategies('phase2-reproduction', 5);

            expect(result).toEqual([]);
            consoleErrorSpy.mockRestore();
        });
    });

    describe('getDashboardSummary', () => {
        it('should aggregate metrics for both layers', async () => {
            mockPrismaClient.reliabilityEvent.findMany
                .mockResolvedValueOnce([
                    { id: 'event-1', triggered: true, recoveryAttempted: true, recoverySuccess: true, threshold: 15 },
                    { id: 'event-2', triggered: false, recoveryAttempted: false, recoverySuccess: undefined, threshold: 15 },
                ])
                .mockResolvedValueOnce([
                    { id: 'event-3', triggered: true, recoveryAttempted: true, recoverySuccess: false, threshold: 15 },
                ]);

            const result = await metrics.getDashboardSummary();

            expect(result).toEqual({
                phase2: {
                    layer: 'phase2-reproduction',
                    totalEvents: 2,
                    triggeredEvents: 1,
                    triggerRate: 0.5,
                    recoveryAttempts: 1,
                    recoverySuccesses: 1,
                    recoverySuccessRate: 1,
                    avgThreshold: 15,
                },
                phase3: {
                    layer: 'phase3-loop-detection',
                    totalEvents: 1,
                    triggeredEvents: 1,
                    triggerRate: 1,
                    recoveryAttempts: 1,
                    recoverySuccesses: 0,
                    recoverySuccessRate: 0,
                    avgThreshold: 15,
                },
                overall: {
                    totalEvents: 3,
                    totalTriggered: 2,
                    totalRecovered: 1,
                },
            });
        });

        it('should handle null layer metrics gracefully', async () => {
            mockPrismaClient.reliabilityEvent.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await metrics.getDashboardSummary();

            expect(result.phase2).toBeNull();
            expect(result.phase3).toBeNull();
            expect(result.overall).toEqual({
                totalEvents: 0,
                totalTriggered: 0,
                totalRecovered: 0,
            });
        });
    });
});
