/**
 * Unit Tests: ReliabilityTelemetry Service
 *
 * Tests the telemetry recording functionality for reliability layer activations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReliabilityTelemetry, ReliabilityEventData } from '../../../../services/reliability/ReliabilityTelemetry.js';

// Mock Prisma Client with proper implementation
const mockPrismaClient = {
    reliabilityEvent: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        deleteMany: vi.fn(),
    },
};

vi.mock('@prisma/client', () => ({
    PrismaClient: class {
        constructor() {
            return mockPrismaClient;
        }
    },
}));

describe('ReliabilityTelemetry', () => {
    let telemetry: ReliabilityTelemetry;

    beforeEach(() => {
        vi.clearAllMocks();
        telemetry = new ReliabilityTelemetry(mockPrismaClient as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('recordEvent', () => {
        it('should record a reliability event successfully', async () => {
            const eventData: ReliabilityEventData = {
                layer: 'phase2-reproduction',
                triggered: true,
                threshold: 1,
                context: {
                    reproductionCommand: 'npm test',
                    filePath: 'src/test.ts',
                    errorType: 'TypeError',
                },
                outcome: 'pending',
            };

            mockPrismaClient.reliabilityEvent.create.mockResolvedValue({ id: 'event-123' });

            await telemetry.recordEvent(eventData);

            expect(mockPrismaClient.reliabilityEvent.create).toHaveBeenCalledWith({
                data: {
                    layer: 'phase2-reproduction',
                    triggered: true,
                    threshold: 1,
                    context: JSON.stringify(eventData.context),
                    outcome: 'pending',
                    recoveryAttempted: false,
                    recoveryStrategy: undefined,
                    recoverySuccess: undefined,
                    agentRunId: undefined,
                },
            });
        });

        it('should record event with recovery outcome', async () => {
            const eventData: ReliabilityEventData = {
                layer: 'phase3-loop-detection',
                triggered: true,
                threshold: 15,
                context: {
                    complexity: 18,
                    complexityHistory: [10, 12, 14, 16, 18],
                    iteration: 5,
                },
                outcome: 'recovered',
                recoveryAttempted: true,
                recoveryStrategy: 'reduce-scope',
                recoverySuccess: true,
            };

            mockPrismaClient.reliabilityEvent.create.mockResolvedValue({ id: 'event-456' });

            await telemetry.recordEvent(eventData);

            expect(mockPrismaClient.reliabilityEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    layer: 'phase3-loop-detection',
                    triggered: true,
                    threshold: 15,
                    outcome: 'recovered',
                    recoveryAttempted: true,
                    recoveryStrategy: 'reduce-scope',
                    recoverySuccess: true,
                }),
            });
        });

        it('should handle recording errors gracefully', async () => {
            const eventData: ReliabilityEventData = {
                layer: 'phase2-reproduction',
                triggered: true,
                threshold: 1,
                context: {},
            };

            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrismaClient.reliabilityEvent.create.mockRejectedValue(new Error('Database error'));

            // Should not throw
            await expect(telemetry.recordEvent(eventData)).resolves.toBeUndefined();

            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('recordReproductionRequired', () => {
        it('should record Phase 2 reproduction requirement trigger', async () => {
            const context = {
                reproductionCommand: undefined,
                errorSummary: 'Test failed in src/test.ts',
                agentRunId: 'run-123',
            };

            mockPrismaClient.reliabilityEvent.create.mockResolvedValue({ id: 'event-789' });

            await telemetry.recordReproductionRequired(context, 1);

            expect(mockPrismaClient.reliabilityEvent.create).toHaveBeenCalledWith({
                data: {
                    layer: 'phase2-reproduction',
                    triggered: true,
                    threshold: 1,
                    context: JSON.stringify(context),
                    outcome: 'pending',
                    recoveryAttempted: false,
                    recoveryStrategy: undefined,
                    recoverySuccess: undefined,
                    agentRunId: 'run-123',
                },
            });
        });

        it('should use default threshold of 1', async () => {
            const context = {
                reproductionCommand: undefined,
            };

            mockPrismaClient.reliabilityEvent.create.mockResolvedValue({ id: 'event-abc' });

            await telemetry.recordReproductionRequired(context);

            expect(mockPrismaClient.reliabilityEvent.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    threshold: 1,
                }),
            });
        });
    });

    describe('recordStrategyLoopDetected', () => {
        it('should record Phase 3 strategy loop trigger', async () => {
            const context = {
                complexity: 18,
                complexityHistory: [10, 12, 14, 16, 18],
                iteration: 5,
                divergingCount: 3,
                agentRunId: 'run-456',
            };

            mockPrismaClient.reliabilityEvent.create.mockResolvedValue({ id: 'event-def' });

            await telemetry.recordStrategyLoopDetected(context, 15);

            expect(mockPrismaClient.reliabilityEvent.create).toHaveBeenCalledWith({
                data: {
                    layer: 'phase3-loop-detection',
                    triggered: true,
                    threshold: 15,
                    context: JSON.stringify(context),
                    outcome: 'pending',
                    recoveryAttempted: false,
                    recoveryStrategy: undefined,
                    recoverySuccess: undefined,
                    agentRunId: 'run-456',
                },
            });
        });
    });

    describe('updateRecoveryOutcome', () => {
        it('should update event with recovery outcome', async () => {
            mockPrismaClient.reliabilityEvent.update.mockResolvedValue({
                id: 'event-123',
                recoveryAttempted: true,
                recoveryStrategy: 'reduce-scope',
                recoverySuccess: true,
                outcome: 'recovered',
            });

            await telemetry.updateRecoveryOutcome('event-123', 'reduce-scope', true);

            expect(mockPrismaClient.reliabilityEvent.update).toHaveBeenCalledWith({
                where: { id: 'event-123' },
                data: {
                    recoveryAttempted: true,
                    recoveryStrategy: 'reduce-scope',
                    recoverySuccess: true,
                    outcome: 'recovered',
                },
            });
        });

        it('should handle failed recovery', async () => {
            mockPrismaClient.reliabilityEvent.update.mockResolvedValue({
                id: 'event-456',
                outcome: 'failed',
                recoverySuccess: false,
            });

            await telemetry.updateRecoveryOutcome('event-456', 'switch-mode', false);

            expect(mockPrismaClient.reliabilityEvent.update).toHaveBeenCalledWith({
                where: { id: 'event-456' },
                data: {
                    recoveryAttempted: true,
                    recoveryStrategy: 'switch-mode',
                    recoverySuccess: false,
                    outcome: 'failed',
                },
            });
        });
    });

    describe('getRecentEvents', () => {
        it('should fetch recent events for a layer', async () => {
            const mockEvents = [
                { id: 'event-1', layer: 'phase2-reproduction', triggered: true },
                { id: 'event-2', layer: 'phase2-reproduction', triggered: false },
            ];

            mockPrismaClient.reliabilityEvent.findMany.mockResolvedValue(mockEvents);

            const events = await telemetry.getRecentEvents('phase2-reproduction', 100);

            expect(events).toEqual(mockEvents);
            expect(mockPrismaClient.reliabilityEvent.findMany).toHaveBeenCalledWith({
                where: { layer: 'phase2-reproduction' },
                orderBy: { createdAt: 'desc' },
                take: 100,
            });
        });

        it('should return empty array on error', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrismaClient.reliabilityEvent.findMany.mockRejectedValue(new Error('Database error'));

            const events = await telemetry.getRecentEvents('phase2-reproduction');

            expect(events).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('getTriggerRate', () => {
        it('should calculate trigger rate correctly', async () => {
            mockPrismaClient.reliabilityEvent.count
                .mockResolvedValueOnce(100) // total events
                .mockResolvedValueOnce(25); // triggered events

            const rate = await telemetry.getTriggerRate('phase2-reproduction');

            expect(rate).toBe(0.25);
            expect(mockPrismaClient.reliabilityEvent.count).toHaveBeenCalledTimes(2);
        });

        it('should return 0 when no events exist', async () => {
            mockPrismaClient.reliabilityEvent.count.mockResolvedValue(0);

            const rate = await telemetry.getTriggerRate('phase2-reproduction');

            expect(rate).toBe(0);
        });

        it('should filter by date when since is provided', async () => {
            const since = new Date('2025-01-01');
            mockPrismaClient.reliabilityEvent.count
                .mockResolvedValueOnce(50)
                .mockResolvedValueOnce(10);

            await telemetry.getTriggerRate('phase2-reproduction', since);

            expect(mockPrismaClient.reliabilityEvent.count).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    layer: 'phase2-reproduction',
                    createdAt: { gte: since },
                }),
            });
        });
    });

    describe('getRecoverySuccessRate', () => {
        it('should calculate recovery success rate correctly', async () => {
            mockPrismaClient.reliabilityEvent.count
                .mockResolvedValueOnce(40) // total recovery attempts
                .mockResolvedValueOnce(30); // successful recoveries

            const rate = await telemetry.getRecoverySuccessRate('phase3-loop-detection');

            expect(rate).toBe(0.75);
        });

        it('should return 0 when no recovery attempts', async () => {
            mockPrismaClient.reliabilityEvent.count.mockResolvedValue(0);

            const rate = await telemetry.getRecoverySuccessRate('phase3-loop-detection');

            expect(rate).toBe(0);
        });
    });

    describe('deleteOldEvents', () => {
        it('should delete events older than specified days', async () => {
            mockPrismaClient.reliabilityEvent.deleteMany.mockResolvedValue({ count: 150 });

            const count = await telemetry.deleteOldEvents(30);

            expect(count).toBe(150);
            expect(mockPrismaClient.reliabilityEvent.deleteMany).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    createdAt: expect.objectContaining({
                        lt: expect.any(Date),
                    }),
                }),
            });
        });

        it('should return 0 on error', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockPrismaClient.reliabilityEvent.deleteMany.mockRejectedValue(new Error('Database error'));

            const count = await telemetry.deleteOldEvents(30);

            expect(count).toBe(0);
            consoleErrorSpy.mockRestore();
        });
    });
});
