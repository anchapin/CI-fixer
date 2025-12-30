/**
 * AdaptiveThresholdService Service
 *
 * Dynamically adjusts reliability layer thresholds based on historical performance.
 * Uses telemetry data to optimize thresholds for reduced false positives and improved recovery.
 *
 * Phase 2 Enhancement: Adaptive Thresholds
 */

import { PrismaClient } from '@prisma/client';
import { ReliabilityMetrics } from './ReliabilityMetrics.js';

export interface ThresholdConfig {
    min: number;
    max: number;
    current: number;
    learningRate: number; // How quickly to adjust (0.0 - 1.0)
}

export interface AdaptiveThresholdsConfig {
    enabled: boolean;
    phase2ReproductionThreshold: ThresholdConfig;
    phase3ComplexityThreshold: ThresholdConfig;
    phase3IterationThreshold: ThresholdConfig;
}

export const DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG: AdaptiveThresholdsConfig = {
    enabled: true,
    phase2ReproductionThreshold: {
        min: 1,
        max: 3,
        current: 1,
        learningRate: 0.1,
    },
    phase3ComplexityThreshold: {
        min: 10,
        max: 25,
        current: 15,
        learningRate: 0.1,
    },
    phase3IterationThreshold: {
        min: 1,
        max: 5,
        current: 2,
        learningRate: 0.05,
    },
};

export interface ThresholdAdjustment {
    layer: 'phase2-reproduction' | 'phase3-loop-detection';
    thresholdType: 'reproduction' | 'complexity' | 'iteration';
    oldValue: number;
    newValue: number;
    confidence: number;
    reasoning: string;
    applied: boolean; // Whether the adjustment was applied
}

export class AdaptiveThresholdService {
    private prisma: PrismaClient;
    private metrics: ReliabilityMetrics;
    private config: AdaptiveThresholdsConfig;

    constructor(prisma?: PrismaClient, config?: AdaptiveThresholdsConfig) {
        this.prisma = prisma || new PrismaClient();
        this.metrics = new ReliabilityMetrics(this.prisma);
        this.config = config || { ...DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG };
    }

    /**
     * Get current adaptive threshold configuration
     */
    getConfig(): AdaptiveThresholdsConfig {
        return { ...this.config };
    }

    /**
     * Update adaptive threshold configuration
     */
    updateConfig(config: Partial<AdaptiveThresholdsConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current threshold for a specific layer and type
     */
    getCurrentThreshold(
        layer: 'phase2-reproduction' | 'phase3-loop-detection',
        type: 'reproduction' | 'complexity' | 'iteration'
    ): number {
        if (layer === 'phase2-reproduction') {
            return this.config.phase2ReproductionThreshold.current;
        } else {
            return type === 'complexity'
                ? this.config.phase3ComplexityThreshold.current
                : this.config.phase3IterationThreshold.current;
        }
    }

    /**
     * Analyze and potentially adjust thresholds based on historical data
     * Returns list of adjustments that were considered
     */
    async analyzeAndAdjustThresholds(
        minDataPoints: number = 30
    ): Promise<ThresholdAdjustment[]> {
        if (!this.config.enabled) {
            return [];
        }

        const adjustments: ThresholdAdjustment[] = [];

        // Analyze Phase 2 threshold
        const phase2Adjustment = await this.analyzePhase2Threshold(minDataPoints);
        if (phase2Adjustment) {
            adjustments.push(phase2Adjustment);
            if (phase2Adjustment.applied) {
                this.config.phase2ReproductionThreshold.current = phase2Adjustment.newValue;
            }
        }

        // Analyze Phase 3 complexity threshold
        const phase3ComplexityAdjustment = await this.analyzePhase3ComplexityThreshold(minDataPoints);
        if (phase3ComplexityAdjustment) {
            adjustments.push(phase3ComplexityAdjustment);
            if (phase3ComplexityAdjustment.applied) {
                this.config.phase3ComplexityThreshold.current = phase3ComplexityAdjustment.newValue;
            }
        }

        // Analyze Phase 3 iteration threshold
        const phase3IterationAdjustment = await this.analyzePhase3IterationThreshold(minDataPoints);
        if (phase3IterationAdjustment) {
            adjustments.push(phase3IterationAdjustment);
            if (phase3IterationAdjustment.applied) {
                this.config.phase3IterationThreshold.current = phase3IterationAdjustment.newValue;
            }
        }

        return adjustments;
    }

    /**
     * Analyze Phase 2 reproduction threshold
     */
    private async analyzePhase2Threshold(
        minDataPoints: number
    ): Promise<ThresholdAdjustment | null> {
        const config = this.config.phase2ReproductionThreshold;
        const analysis = await this.metrics.analyzeThreshold(
            'phase2-reproduction',
            config.current,
            config.min,
            config.max,
            minDataPoints
        );

        // Return null if no analysis or insufficient data
        if (!analysis || analysis.dataPoints < minDataPoints) {
            return null;
        }

        // Decide whether to apply the adjustment
        const shouldApply = analysis.confidence > 0.6 && analysis.recommendedThreshold !== config.current;

        let applied = false;
        let newValue = config.current;

        if (shouldApply) {
            // Apply learning rate for smooth adjustment
            const direction = analysis.recommendedThreshold > config.current ? 1 : -1;
            const adjustment = Math.abs(analysis.recommendedThreshold - config.current) * config.learningRate;
            newValue = Math.max(config.min, Math.min(config.max, config.current + direction * Math.max(1, adjustment)));
            applied = true;
        }

        return {
            layer: 'phase2-reproduction',
            thresholdType: 'reproduction',
            oldValue: config.current,
            newValue,
            confidence: analysis.confidence,
            reasoning: analysis.reasoning,
            applied,
        };
    }

    /**
     * Analyze Phase 3 complexity threshold
     */
    private async analyzePhase3ComplexityThreshold(
        minDataPoints: number
    ): Promise<ThresholdAdjustment | null> {
        const config = this.config.phase3ComplexityThreshold;

        // For complexity, we look at the layer metrics directly
        const layerMetrics = await this.metrics.getLayerMetrics('phase3-loop-detection');
        if (!layerMetrics || !layerMetrics.totalEvents || layerMetrics.totalEvents < minDataPoints) {
            return null;
        }

        const currentComplexityAvg = layerMetrics.avgThreshold;

        // Analyze based on trigger rate and recovery success
        let recommendedValue = config.current;
        let confidence = 0.5;
        let reasoning = '';

        if (layerMetrics.triggerRate > 0.4 && layerMetrics.recoverySuccessRate > 0.7) {
            // High trigger rate with high recovery = threshold too low
            recommendedValue = Math.min(config.max, config.current + 2);
            confidence = 0.7;
            reasoning = `High trigger rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) with high recovery rate (${(layerMetrics.recoverySuccessRate * 100).toFixed(1)}%) - complexity threshold may be too sensitive.`;
        } else if (layerMetrics.triggerRate > 0.3 && layerMetrics.recoverySuccessRate < 0.3) {
            // High trigger rate with poor recovery = threshold too aggressive
            recommendedValue = Math.max(config.min, config.current - 2);
            confidence = 0.8;
            reasoning = `High trigger rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) with low recovery rate (${(layerMetrics.recoverySuccessRate * 100).toFixed(1)}%) - complexity threshold may be too aggressive.`;
        } else if (layerMetrics.triggerRate < 0.1) {
            // Very low trigger rate = threshold too high
            recommendedValue = Math.max(config.min, config.current - 1);
            confidence = 0.6;
            reasoning = `Low trigger rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) - complexity threshold may be too conservative.`;
        } else {
            confidence = 0.9;
            reasoning = `Trigger rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) and recovery rate (${(layerMetrics.recoverySuccessRate * 100).toFixed(1)}%) are within acceptable ranges.`;
        }

        const shouldApply = confidence > 0.6 && recommendedValue !== config.current;

        let applied = false;
        let newValue = config.current;

        if (shouldApply) {
            const direction = recommendedValue > config.current ? 1 : -1;
            const adjustment = Math.abs(recommendedValue - config.current) * config.learningRate;
            newValue = Math.max(config.min, Math.min(config.max, config.current + direction * Math.max(1, adjustment)));
            applied = true;
        }

        return {
            layer: 'phase3-loop-detection',
            thresholdType: 'complexity',
            oldValue: config.current,
            newValue,
            confidence,
            reasoning,
            applied,
        };
    }

    /**
     * Analyze Phase 3 iteration threshold
     */
    private async analyzePhase3IterationThreshold(
        minDataPoints: number
    ): Promise<ThresholdAdjustment | null> {
        const config = this.config.phase3IterationThreshold;

        const layerMetrics = await this.metrics.getLayerMetrics('phase3-loop-detection');
        if (!layerMetrics || !layerMetrics.totalEvents || layerMetrics.totalEvents < minDataPoints) {
            return null;
        }

        // For iteration threshold, we look at how quickly loops are detected
        let recommendedValue = config.current;
        let confidence = 0.5;
        let reasoning = '';

        // Calculate average iteration count from context (this is a simplified approach)
        // In reality, we'd need to parse the context JSON to get iteration data

        if (layerMetrics.triggerRate > 0.5) {
            // High trigger rate suggests loops are common, might want to detect earlier
            recommendedValue = Math.max(config.min, config.current - 1);
            confidence = 0.6;
            reasoning = `High trigger rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) - consider detecting loops earlier (lower iteration threshold).`;
        } else if (layerMetrics.triggerRate < 0.05) {
            // Very low trigger rate, can afford to wait longer
            recommendedValue = Math.min(config.max, config.current + 1);
            confidence = 0.5;
            reasoning = `Low trigger rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) - can afford to wait longer before detecting loops.`;
        } else {
            confidence = 0.9;
            reasoning = `Loop detection rate (${(layerMetrics.triggerRate * 100).toFixed(1)}%) is within acceptable range.`;
        }

        const shouldApply = confidence > 0.6 && recommendedValue !== config.current;

        let applied = false;
        let newValue = config.current;

        if (shouldApply) {
            const direction = recommendedValue > config.current ? 1 : -1;
            const adjustment = Math.abs(recommendedValue - config.current) * config.learningRate;
            newValue = Math.max(config.min, Math.min(config.max, config.current + direction * Math.max(1, adjustment)));
            applied = true;
        }

        return {
            layer: 'phase3-loop-detection',
            thresholdType: 'iteration',
            oldValue: config.current,
            newValue,
            confidence,
            reasoning,
            applied,
        };
    }

    /**
     * Reset all thresholds to default values
     */
    resetToDefaults(): void {
        this.config = { ...DEFAULT_ADAPTIVE_THRESHOLDS_CONFIG };
    }

    /**
     * Get threshold statistics for dashboard/monitoring
     */
    async getThresholdStats(): Promise<{
        config: AdaptiveThresholdsConfig;
        phase2Metrics: any;
        phase3Metrics: any;
    }> {
        const [phase2Metrics, phase3Metrics] = await Promise.all([
            this.metrics.getLayerMetrics('phase2-reproduction'),
            this.metrics.getLayerMetrics('phase3-loop-detection'),
        ]);

        return {
            config: this.getConfig(),
            phase2Metrics,
            phase3Metrics,
        };
    }
}

// Singleton instance for dependency injection
let adaptiveThresholdInstance: AdaptiveThresholdService | null = null;

export function getAdaptiveThresholdService(
    prisma?: PrismaClient,
    config?: AdaptiveThresholdsConfig
): AdaptiveThresholdService {
    if (!adaptiveThresholdInstance) {
        adaptiveThresholdInstance = new AdaptiveThresholdService(prisma, config);
    }
    return adaptiveThresholdInstance;
}
