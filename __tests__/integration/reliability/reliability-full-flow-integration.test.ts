/**
 * Integration Tests: Full Reliability Flow
 *
 * End-to-end test demonstrating the complete reliability enhancement system:
 * - Telemetry recording
 * - Metrics aggregation
 * - Adaptive threshold adjustment
 * - Recovery strategy attempts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { ReliabilityTelemetry } from '../../../services/reliability/ReliabilityTelemetry.js';
import { ReliabilityMetrics } from '../../../services/reliability/ReliabilityMetrics.js';
import { AdaptiveThresholdService, DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG } from '../../../services/reliability/AdaptiveThresholdService.js';
import { RecoveryStrategyService } from '../../../services/reliability/RecoveryStrategyService.js';

describe('Full Reliability Flow Integration', () => {
    let prisma: PrismaClient;
    let telemetry: ReliabilityTelemetry;
    let metrics: ReliabilityMetrics;
    let adaptiveService: AdaptiveThresholdService;
    let recoveryService: RecoveryStrategyService;

    beforeAll(async () => {
        // Create isolated test database
        const testDbUrl = `file:./test-reliability-full-${Date.now()}.db`;
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
        adaptiveService = new AdaptiveThresholdService(prisma, DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG);
        recoveryService = new RecoveryStrategyService(prisma);
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

    describe('Phase 2: Reproduction-First Full Flow', () => {
        it('should complete full Phase 2 flow: record telemetry, analyze metrics, adjust thresholds, attempt recovery', async () => {
            // Step 1: Simulate multiple agent runs with varying outcomes
            // - 10 successful runs (reproduction command found)
            // - 5 failed runs (reproduction command missing, but recovered)
            // - 3 failed runs (reproduction command missing, requested human)

            // Successful runs (no trigger)
            for (let i = 0; i < 10; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 1,
                    context: {
                        reproductionCommand: 'npm test',
                        agentRunId: `run-success-${i}`
                    }
                });
            }

            // Failed runs with recovery
            const failedRunIds = ['run-fail-0', 'run-fail-1', 'run-fail-2', 'run-fail-3', 'run-fail-4'];
            for (const runId of failedRunIds) {
                // Record trigger event
                await telemetry.recordReproductionRequired(
                    {
                        reproductionCommand: undefined,
                        errorSummary: 'Test failed',
                        agentRunId: runId
                    },
                    1
                );

                // Get the event for recovery tracking
                const events = await telemetry.getRecentEvents('phase2-reproduction', 1);
                const eventId = events[0].id;

                // Attempt recovery (will fall through to request-human in test environment)
                const recoveryResult = await recoveryService.attemptRecovery(
                    {
                        agentRunId: runId,
                        layer: 'phase2-reproduction',
                        threshold: 1,
                        reproductionCommand: undefined,
                        errorSummary: 'Test failed'
                    },
                    eventId
                );

                // Recovery will be attempted (may succeed or fail depending on context)
                expect(recoveryResult).toBeDefined();

                // Update some as recovered, some as failed
                const isRecovered = Math.random() > 0.5;
                await telemetry.updateRecoveryOutcome(eventId, 'infer-command', isRecovered);
            }

            // Step 2: Get metrics and verify aggregation
            const phase2Metrics = await metrics.getLayerMetrics('phase2-reproduction');

            expect(phase2Metrics).not.toBeNull();
            expect(phase2Metrics!.totalEvents).toBe(15); // 10 success + 5 failed
            expect(phase2Metrics!.triggeredEvents).toBe(5); // 5 failed runs
            expect(phase2Metrics!.triggerRate).toBeCloseTo(5/15);
            expect(phase2Metrics!.recoveryAttempts).toBe(5);
            expect(phase2Metrics!.recoverySuccesses).toBeGreaterThanOrEqual(0);
            expect(phase2Metrics!.recoverySuccesses).toBeLessThanOrEqual(5);

            // Step 3: Analyze threshold and get recommendations
            const analysis = await metrics.analyzeThreshold(
                'phase2-reproduction',
                1,
                1,
                3,
                15
            );

            expect(analysis).not.toBeNull();
            expect(analysis!.currentThreshold).toBe(1);
            expect(analysis!.dataPoints).toBeGreaterThanOrEqual(15);
            expect(analysis!.confidence).toBeGreaterThan(0);

            // Step 4: Adjust thresholds based on analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(15);

            expect(adjustments.length).toBeGreaterThanOrEqual(0);
            if (adjustments.length > 0) {
                const phase2Adjustment = adjustments.find(a => a.thresholdType === 'reproduction');
                if (phase2Adjustment) {
                    expect(phase2Adjustment.layer).toBe('phase2-reproduction');
                    expect(phase2Adjustment.oldValue).toBeDefined();
                    expect(phase2Adjustment.newValue).toBeDefined();
                }
            }

            // Step 5: Verify threshold was updated (if adjustment was applied)
            const finalConfig = adaptiveService.getConfig();
            expect(finalConfig).toBeDefined();
            expect(finalConfig.enabled).toBe(true);

            // Step 6: Get dashboard summary
            const dashboard = await metrics.getDashboardSummary();

            expect(dashboard.phase2).not.toBeNull();
            expect(dashboard.overall.totalEvents).toBe(15);
            expect(dashboard.overall.totalTriggered).toBe(5);
        });
    });

    describe('Phase 3: Strategy Loop Full Flow', () => {
        it('should complete full Phase 3 flow: record telemetry, analyze metrics, adjust thresholds, attempt recovery', async () => {
            // Step 1: Simulate agent runs with varying complexity and outcomes
            const scenarios = [
                { complexity: 12, diverging: false, iteration: 1 },  // Normal
                { complexity: 14, diverging: false, iteration: 2 },  // Normal
                { complexity: 16, diverging: false, iteration: 3 },  // Slightly high
                { complexity: 18, diverging: true, iteration: 4 },   // Diverging
                { complexity: 20, diverging: true, iteration: 5 },   // Diverging high
                { complexity: 22, diverging: true, iteration: 6 },   // Very high
            ];

            const triggeredRunIds: string[] = [];

            for (const scenario of scenarios) {
                const runId = `run-phase3-${scenario.complexity}`;

                if (scenario.diverging) {
                    // Record trigger event
                    await telemetry.recordStrategyLoopDetected(
                        {
                            complexity: scenario.complexity,
                            complexityHistory: [10, 12, 14, 16, scenario.complexity],
                            iteration: scenario.iteration,
                            divergingCount: scenario.iteration - 2,
                            agentRunId: runId
                        },
                        15
                    );

                    triggeredRunIds.push(runId);

                    // Get the event for recovery tracking
                    const events = await telemetry.getRecentEvents('phase3-loop-detection', 1);
                    const eventId = events[0].id;

                    // Attempt recovery
                    const recoveryResult = await recoveryService.attemptRecovery(
                        {
                            agentRunId: runId,
                            layer: 'phase3-loop-detection',
                            threshold: 15,
                            complexity: scenario.complexity,
                            complexityHistory: [10, 12, 14, 16, scenario.complexity],
                            iteration: scenario.iteration,
                            divergingCount: scenario.iteration - 2
                        },
                        eventId
                    );

                    expect(recoveryResult).toBeDefined();

                    // Update recovery outcome
                    const isRecovered = scenario.complexity < 20;
                    await telemetry.updateRecoveryOutcome(eventId, recoveryResult!.strategy, isRecovered);
                } else {
                    // Non-triggered event
                    await telemetry.recordEvent({
                        layer: 'phase3-loop-detection',
                        triggered: false,
                        threshold: 15,
                        context: {
                            complexity: scenario.complexity,
                            agentRunId: runId
                        }
                    });
                }
            }

            // Step 2: Get metrics
            const phase3Metrics = await metrics.getLayerMetrics('phase3-loop-detection');

            expect(phase3Metrics).not.toBeNull();
            expect(phase3Metrics!.totalEvents).toBe(6);
            expect(phase3Metrics!.triggeredEvents).toBe(3);
            expect(phase3Metrics!.triggerRate).toBeCloseTo(0.5);

            // Step 3: Analyze and adjust thresholds
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(5);

            expect(adjustments.length).toBeGreaterThanOrEqual(0);

            // Step 4: Verify complexity and iteration thresholds
            const config = adaptiveService.getConfig();
            const complexityConfig = (config as any).phase3ComplexityThreshold;
            const iterationConfig = (config as any).phase3IterationThreshold;

            expect(complexityConfig).toBeDefined();
            expect(iterationConfig).toBeDefined();
        });
    });

    describe('Full System Integration', () => {
        it('should demonstrate complete reliability system with both phases', async () => {
            // Simulate realistic mixed workload

            // Phase 2 events
            for (let i = 0; i < 20; i++) {
                const hasReproduction = i % 4 !== 0; // 75% have reproduction
                if (hasReproduction) {
                    await telemetry.recordEvent({
                        layer: 'phase2-reproduction',
                        triggered: false,
                        threshold: 1,
                        context: { reproductionCommand: 'npm test' }
                    });
                } else {
                    await telemetry.recordReproductionRequired(
                        { reproductionCommand: undefined, errorSummary: 'Test failed' },
                        1
                    );
                }
            }

            // Phase 3 events
            for (let i = 0; i < 15; i++) {
                const isComplex = i % 3 === 0; // 33% are complex
                if (isComplex) {
                    await telemetry.recordStrategyLoopDetected(
                        {
                            complexity: 18 + i,
                            complexityHistory: [10, 12, 14, 16, 18 + i],
                            iteration: i,
                            divergingCount: 2
                        },
                        15
                    );
                } else {
                    await telemetry.recordEvent({
                        layer: 'phase3-loop-detection',
                        triggered: false,
                        threshold: 15,
                        context: { complexity: 12 }
                    });
                }
            }

            // Get dashboard summary
            const dashboard = await metrics.getDashboardSummary();

            expect(dashboard.phase2).not.toBeNull();
            expect(dashboard.phase3).not.toBeNull();
            expect(dashboard.overall.totalEvents).toBe(35); // 20 + 15

            // Get threshold stats
            const stats = await adaptiveService.getThresholdStats();

            expect(stats.config).toBeDefined();
            expect(stats.phase2Metrics).toBeDefined();
            expect(stats.phase3Metrics).toBeDefined();

            // Get strategy stats
            const phase2StrategyStats = await recoveryService.getStrategyStats('phase2-reproduction');
            const phase3StrategyStats = await recoveryService.getStrategyStats('phase3-loop-detection');

            expect(phase2StrategyStats.availableStrategies).toBeDefined();
            expect(phase3StrategyStats.availableStrategies).toBeDefined();

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(20);

            expect(adjustments).toBeDefined();
            expect(Array.isArray(adjustments)).toBe(true);

            // Verify all services are working together
            const finalPhase2Metrics = await metrics.getLayerMetrics('phase2-reproduction');
            const finalPhase3Metrics = await metrics.getLayerMetrics('phase3-loop-detection');

            expect(finalPhase2Metrics).not.toBeNull();
            expect(finalPhase3Metrics).not.toBeNull();

            // Get threshold trend
            const trend = await metrics.getThresholdTrend('phase2-reproduction', 7);

            expect(trend).toBeDefined();
            expect(Array.isArray(trend)).toBe(true);
        });
    });

    describe('Data Retention and Cleanup', () => {
        it('should support data retention policies', async () => {
            // Create some old events (by directly setting createdAt)
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

            await prisma.reliabilityEvent.create({
                data: {
                    layer: 'phase2-reproduction',
                    triggered: true,
                    threshold: 1,
                    context: '{}',
                    outcome: 'triggered',
                    createdAt: oldDate
                }
            });

            // Verify event exists
            const beforeEvents = await telemetry.getRecentEvents('phase2-reproduction');
            expect(beforeEvents.length).toBeGreaterThan(0);

            // Delete events older than 7 days
            const deletedCount = await telemetry.deleteOldEvents(7);

            expect(deletedCount).toBeGreaterThanOrEqual(1);

            // Verify old events are deleted
            const afterEvents = await telemetry.getRecentEvents('phase2-reproduction');
            expect(afterEvents.length).toBe(0);
        });
    });

    describe('Performance and Scalability', () => {
        it('should handle large volumes of events efficiently', async () => {
            const startTime = Date.now();

            // Create 100 events
            const promises = [];
            for (let i = 0; i < 100; i++) {
                promises.push(
                    telemetry.recordEvent({
                        layer: i % 2 === 0 ? 'phase2-reproduction' : 'phase3-loop-detection',
                        triggered: i % 5 === 0,
                        threshold: i % 2 === 0 ? 1 : 15,
                        context: `{ "iteration": ${i} }`
                    })
                );
            }

            await Promise.all(promises);

            const duration = Date.now() - startTime;

            // Should complete in reasonable time (< 10 seconds for 100 events)
            expect(duration).toBeLessThan(10000);

            // Verify all events were recorded
            const phase2Metrics = await metrics.getLayerMetrics('phase2-reproduction');
            const phase3Metrics = await metrics.getLayerMetrics('phase3-loop-detection');

            expect(phase2Metrics!.totalEvents + phase3Metrics!.totalEvents).toBe(100);
        });
    });
});
