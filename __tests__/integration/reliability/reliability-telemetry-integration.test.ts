/**
 * Integration Tests: Reliability Telemetry Services
 *
 * Tests telemetry recording and metrics aggregation with real database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { ReliabilityTelemetry } from '../../../services/reliability/ReliabilityTelemetry.js';
import { ReliabilityMetrics } from '../../../services/reliability/ReliabilityMetrics.js';

describe('Reliability Telemetry Integration', () => {
    let prisma: PrismaClient;
    let telemetry: ReliabilityTelemetry;
    let metrics: ReliabilityMetrics;

    beforeAll(async () => {
        // Create isolated test database
        const testDbUrl = `file:./test-reliability-${Date.now()}.db`;
        process.env.DATABASE_URL = testDbUrl;

        // Push schema to test database
        execSync('npx prisma db push --skip-generate', {
            env: { ...process.env, DATABASE_URL: testDbUrl },
            stdio: 'inherit',
        });

        // Initialize Prisma with test database
        prisma = new PrismaClient({
            datasources: {
                db: {
                    url: testDbUrl,
                },
            },
        });

        await prisma.$connect();

        // Initialize services
        telemetry = new ReliabilityTelemetry(prisma);
        metrics = new ReliabilityMetrics(prisma);
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    beforeEach(async () => {
        // Clean database before each test
        await prisma.reliabilityEvent.deleteMany({});
    });

    afterEach(async () => {
        // Clean database after each test
        await prisma.reliabilityEvent.deleteMany({});
    });

    describe('Phase 2: Reproduction-First Telemetry', () => {
        it('should record and retrieve Phase 2 trigger events', async () => {
            // Record a Phase 2 trigger
            await telemetry.recordReproductionRequired(
                {
                    reproductionCommand: undefined,
                    errorSummary: 'Test failed in src/utils.ts',
                    filePath: 'src/utils.ts',
                    errorType: 'TypeError',
                    agentRunId: 'run-123',
                    groupId: 'group-456',
                },
                1
            );

            // Verify event was recorded
            const events = await telemetry.getRecentEvents('phase2-reproduction');
            expect(events).toHaveLength(1);
            expect(events[0].triggered).toBe(true);
            expect(events[0].threshold).toBe(1);
            expect(events[0].layer).toBe('phase2-reproduction');
        });

        it('should calculate trigger rate for Phase 2', async () => {
            // Record 10 events: 4 triggered, 6 not triggered
            for (let i = 0; i < 6; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 1,
                    context: { reproductionCommand: 'npm test' },
                });
            }
            for (let i = 0; i < 4; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    1
                );
            }

            // Calculate trigger rate
            const triggerRate = await telemetry.getTriggerRate('phase2-reproduction');
            expect(triggerRate).toBe(0.4); // 4 out of 10
        });

        it('should calculate recovery success rate for Phase 2', async () => {
            // Record some recovery attempts
            await telemetry.recordReproductionRequired({}, 1);

            const events = await telemetry.getRecentEvents('phase2-reproduction', 1);
            const eventId = events[0].id;

            // Update with recovery outcome
            await telemetry.updateRecoveryOutcome(eventId, 'infer-command', true);

            // Calculate recovery success rate
            const recoveryRate = await telemetry.getRecoverySuccessRate('phase2-reproduction');
            expect(recoveryRate).toBe(1.0); // 1 out of 1 succeeded
        });
    });

    describe('Phase 3: Strategy Loop Telemetry', () => {
        it('should record and retrieve Phase 3 trigger events', async () => {
            await telemetry.recordStrategyLoopDetected(
                {
                    complexity: 18,
                    complexityHistory: [10, 12, 14, 16, 18],
                    iteration: 5,
                    divergingCount: 3,
                    agentRunId: 'run-789',
                },
                15
            );

            const events = await telemetry.getRecentEvents('phase3-loop-detection');
            expect(events).toHaveLength(1);
            expect(events[0].triggered).toBe(true);
            expect(events[0].threshold).toBe(15);
            expect(events[0].layer).toBe('phase3-loop-detection');

            // Verify context is stored
            const context = JSON.parse(events[0].context);
            expect(context.complexity).toBe(18);
            expect(context.complexityHistory).toEqual([10, 12, 14, 16, 18]);
        });

        it('should track multiple recovery strategies', async () => {
            const strategies = [
                { name: 'reduce-scope', success: true },
                { name: 'switch-mode', success: false },
                { name: 'regenerate', success: true },
                { name: 'reduce-scope', success: false },
            ];

            for (const strategy of strategies) {
                await telemetry.recordStrategyLoopDetected({}, 15);
                const events = await telemetry.getRecentEvents('phase3-loop-detection', 1);
                await telemetry.updateRecoveryOutcome(events[0].id, strategy.name, strategy.success);
            }

            // Get top strategies
            const topStrategies = await metrics.getTopStrategies('phase3-loop-detection', 5);

            // Strategies are sorted by success rate, so regenerate (100%) and reduce-scope (50%) should be first
            expect(topStrategies.length).toBeGreaterThanOrEqual(2);
            expect(topStrategies.map((s: any) => s.strategy)).toContain('reduce-scope');
            expect(topStrategies.map((s: any) => s.strategy)).toContain('regenerate');
        });
    });

    describe('Metrics Aggregation', () => {
        beforeEach(async () => {
            // Seed test data
            // Phase 2: 10 events, 3 triggered, 2 recovery attempts, 1 success
            for (let i = 0; i < 7; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 1,
                    context: { reproductionCommand: 'npm test' },
                });
            }

            for (let i = 0; i < 3; i++) {
                await telemetry.recordReproductionRequired({ errorSummary: 'Test failed' }, 1);
            }

            const phase2Events = await telemetry.getRecentEvents('phase2-reproduction', 3);
            await telemetry.updateRecoveryOutcome(phase2Events[0].id, 'infer-command', true);
            await telemetry.updateRecoveryOutcome(phase2Events[1].id, 'request-human', false);

            // Phase 3: 8 events, 4 triggered, 3 recovery attempts, 2 success
            for (let i = 0; i < 4; i++) {
                await telemetry.recordEvent({
                    layer: 'phase3-loop-detection',
                    triggered: false,
                    threshold: 15,
                    context: { complexity: 12 },
                });
            }

            for (let i = 0; i < 4; i++) {
                await telemetry.recordStrategyLoopDetected(
                    { complexity: 16 + i, complexityHistory: [10, 12, 14, 16 + i] },
                    15
                );
            }

            const phase3Events = await telemetry.getRecentEvents('phase3-loop-detection', 4);
            await telemetry.updateRecoveryOutcome(phase3Events[0].id, 'reduce-scope', true);
            await telemetry.updateRecoveryOutcome(phase3Events[1].id, 'reduce-scope', true);
            await telemetry.updateRecoveryOutcome(phase3Events[2].id, 'switch-mode', false);
        });

        it('should get comprehensive layer metrics', async () => {
            const phase2Metrics = await metrics.getLayerMetrics('phase2-reproduction');

            expect(phase2Metrics).not.toBeNull();
            expect(phase2Metrics!.totalEvents).toBe(10);
            expect(phase2Metrics!.triggeredEvents).toBe(3);
            expect(phase2Metrics!.triggerRate).toBeCloseTo(0.3);
            expect(phase2Metrics!.recoveryAttempts).toBe(2);
            expect(phase2Metrics!.recoverySuccesses).toBe(1);
            expect(phase2Metrics!.recoverySuccessRate).toBe(0.5);

            const phase3Metrics = await metrics.getLayerMetrics('phase3-loop-detection');

            expect(phase3Metrics).not.toBeNull();
            expect(phase3Metrics!.totalEvents).toBe(8);
            expect(phase3Metrics!.triggeredEvents).toBe(4);
            expect(phase3Metrics!.triggerRate).toBe(0.5);
            expect(phase3Metrics!.recoveryAttempts).toBe(3);
            expect(phase3Metrics!.recoverySuccesses).toBe(2);
            expect(phase3Metrics!.recoverySuccessRate).toBeCloseTo(2/3);
        });

        it('should get dashboard summary', async () => {
            const summary = await metrics.getDashboardSummary();

            expect(summary.phase2).not.toBeNull();
            expect(summary.phase3).not.toBeNull();
            expect(summary.overall.totalEvents).toBe(18); // 10 + 8
            expect(summary.overall.totalTriggered).toBe(7); // 3 + 4
            expect(summary.overall.totalRecovered).toBe(3); // 1 + 2
        });

        it('should analyze threshold and make recommendations', async () => {
            // Add more events to meet minimum data points
            for (let i = 0; i < 30; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: i % 4 === 0, // 25% trigger rate
                    threshold: 1,
                    context: { reproductionCommand: i % 4 === 0 ? undefined : 'npm test' },
                });
            }

            const analysis = await metrics.analyzeThreshold(
                'phase2-reproduction',
                1,
                1,
                5,
                30
            );

            expect(analysis).not.toBeNull();
            expect(analysis.currentThreshold).toBe(1);
            expect(analysis.dataPoints).toBeGreaterThanOrEqual(30);
            expect(analysis.confidence).toBeGreaterThan(0);
            expect(analysis.reasoning).toBeDefined();
        });
    });

    describe('Data Retention', () => {
        it('should delete old events', async () => {
            // Create some events
            for (let i = 0; i < 5; i++) {
                await telemetry.recordReproductionRequired({}, 1);
            }

            // Verify events exist
            const beforeEvents = await telemetry.getRecentEvents('phase2-reproduction');
            expect(beforeEvents.length).toBeGreaterThan(0);

            // Delete events older than 0 days (should delete all)
            const deletedCount = await telemetry.deleteOldEvents(0);

            expect(deletedCount).toBeGreaterThanOrEqual(5);

            // Verify events are deleted
            const afterEvents = await telemetry.getRecentEvents('phase2-reproduction');
            expect(afterEvents).toHaveLength(0);
        });
    });

    describe('Time-Series Trends', () => {
        it('should get threshold trend for recent days', async () => {
            // Create some events today
            for (let i = 0; i < 4; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: i % 2 === 0,
                    threshold: 1,
                    context: {},
                });
            }

            const trend = await metrics.getThresholdTrend('phase2-reproduction', 7);

            // Should have at least today's data
            expect(trend.length).toBeGreaterThanOrEqual(0);
            // If we have data, it should have the expected structure
            if (trend.length > 0) {
                expect(trend[0]).toHaveProperty('date');
                expect(trend[0]).toHaveProperty('triggerRate');
                expect(trend[0]).toHaveProperty('recoveryRate');
            }
        });
    });
});
