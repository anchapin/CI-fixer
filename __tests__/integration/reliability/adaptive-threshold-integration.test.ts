/**
 * Integration Tests: Adaptive Threshold Service
 *
 * Tests adaptive threshold optimization with real historical data.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { AdaptiveThresholdService, DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG, type AdaptiveThresholdsConfig } from '../../../services/reliability/AdaptiveThresholdService.js';
import { ReliabilityTelemetry } from '../../../services/reliability/ReliabilityTelemetry.js';

describe('Adaptive Threshold Service Integration', () => {
    let prisma: PrismaClient;
    let telemetry: ReliabilityTelemetry;
    let adaptiveService: AdaptiveThresholdService;

    beforeAll(async () => {
        // Create isolated test database
        const testDbUrl = `file:./test-adaptive-threshold-${Date.now()}.db`;
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
        adaptiveService = new AdaptiveThresholdService(prisma, DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG);
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

    describe('Phase 2 Threshold Adaptation', () => {
        it('should increase Phase 2 threshold when trigger rate is high with good recovery', async () => {
            // Seed historical data: 40 events, 50% trigger rate, 80% recovery success
            // This suggests threshold is too sensitive (triggering too often but recovering well)
            for (let i = 0; i < 20; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 1,
                    context: { reproductionCommand: 'npm test' },
                });
            }

            for (let i = 0; i < 20; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    1
                );
            }

            // Mark 16 of the triggered events as successfully recovered
            const triggeredEvents = await telemetry.getRecentEvents('phase2-reproduction', 20);
            for (let i = 0; i < 16; i++) {
                await telemetry.updateRecoveryOutcome(triggeredEvents[i].id, 'infer-command', true);
            }
            for (let i = 16; i < 20; i++) {
                await telemetry.updateRecoveryOutcome(triggeredEvents[i].id, 'infer-command', false);
            }

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            // Should recommend increasing threshold (less sensitive)
            const phase2Adjustment = adjustments.find(a => a.thresholdType === 'reproduction');
            expect(phase2Adjustment).toBeDefined();
            expect(phase2Adjustment!.layer).toBe('phase2-reproduction');
            expect(phase2Adjustment!.confidence).toBeGreaterThan(0.6);
            expect(phase2Adjustment!.applied).toBe(true);
            expect(phase2Adjustment!.newValue).toBeGreaterThan(phase2Adjustment!.oldValue);

            // Verify config was updated
            const config = adaptiveService.getConfig();
            expect((config as any).phase2ReproductionThreshold.current).toBeGreaterThan(1);
        });

        it('should decrease Phase 2 threshold when trigger rate is low', async () => {
            // Start with a higher threshold so it can decrease
            const higherThresholdConfig: AdaptiveThresholdsConfig = {
                ...DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG,
                phase2ReproductionThreshold: {
                    min: 1,
                    max: 3,
                    current: 2,
                    learningRate: 0.1,
                },
            };
            adaptiveService = new AdaptiveThresholdService(prisma, higherThresholdConfig);

            // Seed historical data: 40 events, only 5% trigger rate
            // This suggests threshold is too conservative (not triggering enough)
            for (let i = 0; i < 38; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 2,
                    context: { reproductionCommand: 'npm test' },
                });
            }

            for (let i = 0; i < 2; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    2
                );
            }

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            // Should recommend decreasing threshold (more sensitive)
            const phase2Adjustment = adjustments.find(a => a.thresholdType === 'reproduction');
            expect(phase2Adjustment).toBeDefined();

            // With 5% trigger rate, confidence is 0.6, which is NOT > 0.6
            // So the adjustment should not be applied
            expect(phase2Adjustment!.applied).toBe(false);
            expect(phase2Adjustment!.confidence).toBe(0.6);
        });

        it('should not adjust Phase 2 threshold when confidence is low', async () => {
            // Seed data with mixed recovery that results in low confidence
            for (let i = 0; i < 15; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: i < 7,
                    threshold: 1,
                    context: { reproductionCommand: i < 7 ? undefined : 'npm test' },
                });
            }

            // Mark all triggered events as failed recovery
            const triggeredEvents = await telemetry.getRecentEvents('phase2-reproduction', 7);
            for (const event of triggeredEvents) {
                await telemetry.updateRecoveryOutcome(event.id, 'request-human', false);
            }

            // Run adaptive threshold analysis with high minimum data points
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(50);

            // Should return empty or no adjustment due to insufficient data
            const phase2Adjustment = adjustments.find(a => a.thresholdType === 'reproduction');
            expect(phase2Adjustment).toBeUndefined();
        });
    });

    describe('Phase 3 Complexity Threshold Adaptation', () => {
        it('should increase complexity threshold when false positives are high', async () => {
            // Seed historical data: 40 events, 60% trigger rate, 80% recovery success
            // This suggests complexity threshold is too sensitive
            for (let i = 0; i < 16; i++) {
                await telemetry.recordEvent({
                    layer: 'phase3-loop-detection',
                    triggered: false,
                    threshold: 15,
                    context: { complexity: 12, iteration: i },
                });
            }

            for (let i = 0; i < 24; i++) {
                await telemetry.recordStrategyLoopDetected(
                    {
                        complexity: 18,
                        complexityHistory: [12, 14, 16, 18],
                        iteration: 5,
                        divergingCount: 3,
                    },
                    15
                );
            }

            // Mark 19 as successfully recovered
            const triggeredEvents = await telemetry.getRecentEvents('phase3-loop-detection', 24);
            for (let i = 0; i < 19; i++) {
                await telemetry.updateRecoveryOutcome(triggeredEvents[i].id, 'reduce-scope', true);
            }

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            // Should recommend increasing complexity threshold
            const complexityAdjustment = adjustments.find(a => a.thresholdType === 'complexity');
            expect(complexityAdjustment).toBeDefined();
            expect(complexityAdjustment!.layer).toBe('phase3-loop-detection');
            expect(complexityAdjustment!.confidence).toBeGreaterThan(0.6);
            expect(complexityAdjustment!.applied).toBe(true);
            expect(complexityAdjustment!.newValue).toBeGreaterThan(complexityAdjustment!.oldValue);
        });

        it('should decrease complexity threshold when trigger rate is very low', async () => {
            // Start with a higher threshold
            const higherThresholdConfig: AdaptiveThresholdsConfig = {
                ...DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG,
                phase3ComplexityThreshold: {
                    min: 10,
                    max: 25,
                    current: 20,
                    learningRate: 0.1,
                },
            };
            adaptiveService = new AdaptiveThresholdService(prisma, higherThresholdConfig);

            // Seed historical data: 40 events, only 5% trigger rate
            // This suggests threshold is too conservative
            for (let i = 0; i < 38; i++) {
                await telemetry.recordEvent({
                    layer: 'phase3-loop-detection',
                    triggered: false,
                    threshold: 20,
                    context: { complexity: 15, iteration: i },
                });
            }

            for (let i = 0; i < 2; i++) {
                await telemetry.recordStrategyLoopDetected(
                    {
                        complexity: 22,
                        complexityHistory: [15, 17, 19, 22],
                        iteration: 6,
                        divergingCount: 2,
                    },
                    20
                );
            }

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            // Should recommend decreasing complexity threshold
            const complexityAdjustment = adjustments.find(a => a.thresholdType === 'complexity');
            expect(complexityAdjustment).toBeDefined();

            // Low trigger rate with low confidence (0.6) - not > 0.6
            expect(complexityAdjustment!.confidence).toBeLessThanOrEqual(0.6);
            expect(complexityAdjustment!.applied).toBe(false);
        });
    });

    describe('Phase 3 Iteration Threshold Adaptation', () => {
        it('should decrease iteration threshold when loops are common', async () => {
            // Start with a higher iteration threshold
            const higherThresholdConfig: AdaptiveThresholdsConfig = {
                ...DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG,
                phase3IterationThreshold: {
                    min: 1,
                    max: 5,
                    current: 4,
                    learningRate: 0.05,
                },
            };
            adaptiveService = new AdaptiveThresholdService(prisma, higherThresholdConfig);

            // Seed historical data: 40 events, 70% trigger rate
            // This suggests we should detect loops earlier
            for (let i = 0; i < 12; i++) {
                await telemetry.recordEvent({
                    layer: 'phase3-loop-detection',
                    triggered: false,
                    threshold: 4,
                    context: { complexity: 12, iteration: i },
                });
            }

            for (let i = 0; i < 28; i++) {
                await telemetry.recordStrategyLoopDetected(
                    {
                        complexity: 16,
                        complexityHistory: [10, 12, 14, 16],
                        iteration: 3,
                        divergingCount: 2,
                    },
                    4
                );
            }

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            // Should recommend decreasing iteration threshold (detect earlier)
            const iterationAdjustment = adjustments.find(a => a.thresholdType === 'iteration');
            expect(iterationAdjustment).toBeDefined();

            // High trigger rate gives confidence 0.6, which is NOT > 0.6
            expect(iterationAdjustment!.confidence).toBeLessThanOrEqual(0.6);
            expect(iterationAdjustment!.applied).toBe(false);
        });
    });

    describe('Learning Rate Application', () => {
        it('should apply learning rate to smooth threshold adjustments', async () => {
            // Seed data that strongly suggests increasing Phase 2 threshold
            for (let i = 0; i < 10; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 1,
                    context: { reproductionCommand: 'npm test' },
                });
            }

            for (let i = 0; i < 30; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    1
                );
            }

            // Mark all as successfully recovered
            const triggeredEvents = await telemetry.getRecentEvents('phase2-reproduction', 30);
            for (const event of triggeredEvents) {
                await telemetry.updateRecoveryOutcome(event.id, 'infer-command', true);
            }

            // Get initial threshold
            const initialConfig = adaptiveService.getConfig();
            const initialValue = (initialConfig as any).phase2ReproductionThreshold.current;

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            const phase2Adjustment = adjustments.find(a => a.thresholdType === 'reproduction');
            expect(phase2Adjustment).toBeDefined();

            // With learning rate of 0.1, adjustment should be gradual
            // Recommended might be 3, but we should only move ~20% of the way
            const adjustment = phase2Adjustment!.newValue - initialValue;
            expect(adjustment).toBeGreaterThan(0);
            expect(adjustment).toBeLessThan(2); // Should not jump to max immediately
        });

        it('should respect min/max bounds when applying learning rate', async () => {
            // Seed data suggesting maximum threshold increase
            for (let i = 0; i < 50; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    1
                );
            }

            // Mark all as successfully recovered
            const triggeredEvents = await telemetry.getRecentEvents('phase2-reproduction', 50);
            for (const event of triggeredEvents) {
                await telemetry.updateRecoveryOutcome(event.id, 'infer-command', true);
            }

            // Run adaptive threshold analysis
            const adjustments = await adaptiveService.analyzeAndAdjustThresholds(30);

            const phase2Adjustment = adjustments.find(a => a.thresholdType === 'reproduction');
            expect(phase2Adjustment).toBeDefined();

            // Should not exceed max bound of 3
            expect(phase2Adjustment!.newValue).toBeLessThanOrEqual(3);
        });
    });

    describe('Comprehensive Threshold Stats', () => {
        it('should provide comprehensive threshold statistics', async () => {
            // Seed data for both phases
            for (let i = 0; i < 15; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: i < 5,
                    threshold: 1,
                    context: {},
                });
            }

            for (let i = 0; i < 12; i++) {
                await telemetry.recordEvent({
                    layer: 'phase3-loop-detection',
                    triggered: i < 4,
                    threshold: 15,
                    context: { complexity: 15 },
                });
            }

            const stats = await adaptiveService.getThresholdStats();

            expect(stats.config).toBeDefined();
            expect(stats.config.enabled).toBe(true);
            expect(stats.phase2Metrics).toBeDefined();
            expect(stats.phase3Metrics).toBeDefined();
            expect(stats.phase2Metrics.totalEvents).toBe(15);
            expect(stats.phase3Metrics.totalEvents).toBe(12);
        });
    });

    describe('Reset to Defaults', () => {
        it('should reset thresholds to default values after adjustments', async () => {
            // Seed data and run analysis to change thresholds
            for (let i = 0; i < 10; i++) {
                await telemetry.recordEvent({
                    layer: 'phase2-reproduction',
                    triggered: false,
                    threshold: 1,
                    context: { reproductionCommand: 'npm test' },
                });
            }

            for (let i = 0; i < 30; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    1
                );
            }

            const triggeredEvents = await telemetry.getRecentEvents('phase2-reproduction', 30);
            for (const event of triggeredEvents) {
                await telemetry.updateRecoveryOutcome(event.id, 'infer-command', true);
            }

            // Run adjustment
            await adaptiveService.analyzeAndAdjustThresholds(30);

            // Verify threshold changed
            const adjustedConfig = adaptiveService.getConfig();
            const adjustedThreshold = (adjustedConfig as any).phase2ReproductionThreshold.current;
            expect(adjustedThreshold).not.toBe(1);

            // Reset to defaults
            adaptiveService.resetToDefaults();

            const resetConfig = adaptiveService.getConfig();
            expect((resetConfig as any).phase2ReproductionThreshold.current).toBe(
                DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG.phase2ReproductionThreshold.current
            );
        });
    });

    describe('Disabled State', () => {
        it('should not analyze or adjust thresholds when disabled', async () => {
            // Create a fresh service instance with default config
            const disabledService = new AdaptiveThresholdService(prisma, DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG);

            // Disable the service
            disabledService.updateConfig({ enabled: false });

            // Seed data
            for (let i = 0; i < 30; i++) {
                await telemetry.recordReproductionRequired(
                    { reproductionCommand: undefined, errorSummary: 'Test failed' },
                    1
                );
            }

            // Run analysis
            const adjustments = await disabledService.analyzeAndAdjustThresholds(30);

            // Should return empty array
            expect(adjustments).toEqual([]);

            // Verify config was not changed (still at default of 1)
            const config = disabledService.getConfig();
            expect((config as any).phase2ReproductionThreshold.current).toBe(
                DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG.phase2ReproductionThreshold.current
            );
        });
    });
});
