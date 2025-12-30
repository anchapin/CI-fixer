/**
 * ReliabilityMetrics Service
 *
 * Aggregates and analyzes reliability layer telemetry data.
 * Provides insights for adaptive thresholds and recovery strategy optimization.
 *
 * Phase 1 Enhancement: Telemetry & Observability
 */

import { PrismaClient } from '@prisma/client';
import { ReliabilityTelemetry } from './ReliabilityTelemetry.js';

export interface LayerMetrics {
  layer: 'phase2-reproduction' | 'phase3-loop-detection';
  totalEvents: number;
  triggeredEvents: number;
  triggerRate: number;
  recoveryAttempts: number;
  recoverySuccesses: number;
  recoverySuccessRate: number;
  avgThreshold: number;
  falsePositiveRate?: number; // Events that triggered but would have succeeded
}

export interface ThresholdAnalysis {
  currentThreshold: number;
  recommendedThreshold: number;
  confidence: number;
  reasoning: string;
  dataPoints: number;
}

export class ReliabilityMetrics {
  private prisma: PrismaClient;
  private telemetry: ReliabilityTelemetry;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || new PrismaClient();
    this.telemetry = new ReliabilityTelemetry(this.prisma);
  }

  /**
   * Get comprehensive metrics for a reliability layer
   */
  async getLayerMetrics(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    since?: Date
  ): Promise<LayerMetrics | null> {
    try {
      const where: any = { layer };
      if (since) {
        where.createdAt = { gte: since };
      }

      const events = await this.prisma.reliabilityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      if (events.length === 0) {
        return null;
      }

      const triggeredEvents = events.filter((e) => e.triggered);
      const recoveryAttempts = events.filter((e) => e.recoveryAttempted);
      const recoverySuccesses = recoveryAttempts.filter((e) => e.recoverySuccess);

      const avgThreshold =
        triggeredEvents.reduce((sum, e) => sum + e.threshold, 0) / triggeredEvents.length;

      return {
        layer,
        totalEvents: events.length,
        triggeredEvents: triggeredEvents.length,
        triggerRate: triggeredEvents.length / events.length,
        recoveryAttempts: recoveryAttempts.length,
        recoverySuccesses: recoverySuccesses.length,
        recoverySuccessRate:
          recoveryAttempts.length > 0 ? recoverySuccesses.length / recoveryAttempts.length : 0,
        avgThreshold,
      };
    } catch (error) {
      console.error('[ReliabilityMetrics] Failed to get layer metrics:', error);
      return null;
    }
  }

  /**
   * Analyze whether a threshold should be adjusted
   * Returns recommendation for adaptive thresholds
   */
  async analyzeThreshold(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    currentThreshold: number,
    minThreshold: number,
    maxThreshold: number,
    minDataPoints: number = 30
  ): Promise<ThresholdAnalysis | null> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30); // Last 30 days

      const events = await this.prisma.reliabilityEvent.findMany({
        where: { layer, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      });

      if (events.length < minDataPoints) {
        return {
          currentThreshold,
          recommendedThreshold: currentThreshold,
          confidence: 0,
          reasoning: `Insufficient data (${events.length} events, need ${minDataPoints})`,
          dataPoints: events.length,
        };
      }

      const triggeredEvents = events.filter((e) => e.triggered);

      if (triggeredEvents.length === 0) {
        // Layer never triggered - could decrease threshold
        return {
          currentThreshold,
          recommendedThreshold: Math.max(minThreshold, currentThreshold - 1),
          confidence: 0.5,
          reasoning: 'Layer has not triggered recently - consider decreasing threshold to catch more edge cases',
          dataPoints: events.length,
        };
      }

      // Calculate recovery success rate for triggered events
      const recoveredEvents = triggeredEvents.filter((e) => e.recoverySuccess === true);
      const recoveryRate = recoveredEvents.length / triggeredEvents.length;

      // High recovery rate + high trigger rate = threshold too low (too sensitive)
      // Low recovery rate + high trigger rate = threshold too high (not sensitive enough)
      // High recovery rate + low trigger rate = threshold is good
      // Low recovery rate + low trigger rate = threshold is good

      let recommendedThreshold = currentThreshold;
      let reasoning = '';
      let confidence = 0.5;

      const triggerRate = triggeredEvents.length / events.length;

      if (recoveryRate > 0.7 && triggerRate > 0.3) {
        // Too many triggers but successful recoveries - could increase threshold
        const increase = Math.ceil((triggerRate - 0.3) * 10); // Scale based on excess
        recommendedThreshold = Math.min(maxThreshold, currentThreshold + increase);
        reasoning = `High recovery rate (${(recoveryRate * 100).toFixed(1)}%) with high trigger rate (${(triggerRate * 100).toFixed(1)}%) - threshold may be too sensitive. Consider increasing to reduce false positives.`;
        confidence = 0.7;
      } else if (recoveryRate < 0.3 && triggerRate > 0.2) {
        // Poor recovery rate with high trigger rate - threshold is preventing useful work
        const decrease = Math.ceil((1 - recoveryRate) * 2); // Scale based on failure rate
        recommendedThreshold = Math.max(minThreshold, currentThreshold - decrease);
        reasoning = `Low recovery rate (${(recoveryRate * 100).toFixed(1)}%) with high trigger rate (${(triggerRate * 100).toFixed(1)}%) - threshold may be too aggressive. Consider decreasing to allow more attempts.`;
        confidence = 0.8;
      } else if (triggerRate < 0.1) {
        // Very low trigger rate - threshold may be too high
        recommendedThreshold = Math.max(minThreshold, currentThreshold - 1);
        reasoning = `Low trigger rate (${(triggerRate * 100).toFixed(1)}%) - threshold may be too conservative. Consider decreasing to catch more issues.`;
        confidence = 0.6;
      } else {
        // Balance looks good
        recommendedThreshold = currentThreshold;
        reasoning = `Trigger rate (${(triggerRate * 100).toFixed(1)}%) and recovery rate (${(recoveryRate * 100).toFixed(1)}%) are within acceptable ranges. No change recommended.`;
        confidence = 0.9;
      }

      return {
        currentThreshold,
        recommendedThreshold,
        confidence,
        reasoning,
        dataPoints: events.length,
      };
    } catch (error) {
      console.error('[ReliabilityMetrics] Failed to analyze threshold:', error);
      return null;
    }
  }

  /**
   * Get time-series data for threshold visualization
   */
  async getThresholdTrend(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    days: number = 7
  ): Promise<Array<{ date: string; triggerRate: number; recoveryRate: number }>> {
    try {
      const results = [];

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const events = await this.prisma.reliabilityEvent.findMany({
          where: {
            layer,
            createdAt: { gte: date, lt: nextDate },
          },
        });

        if (events.length > 0) {
          const triggeredEvents = events.filter((e) => e.triggered);
          const recoveredEvents = triggeredEvents.filter((e) => e.recoverySuccess === true);

          results.push({
            date: date.toISOString().split('T')[0],
            triggerRate: triggeredEvents.length / events.length,
            recoveryRate:
              triggeredEvents.length > 0 ? recoveredEvents.length / triggeredEvents.length : 0,
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[ReliabilityMetrics] Failed to get threshold trend:', error);
      return [];
    }
  }

  /**
   * Get top strategies by success rate
   */
  async getTopStrategies(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    limit: number = 5
  ): Promise<Array<{ strategy: string; successRate: number; attempts: number }>> {
    try {
      const events = await this.prisma.reliabilityEvent.findMany({
        where: {
          layer,
          recoveryAttempted: true,
          recoveryStrategy: { not: null },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Group by strategy and calculate success rates
      const strategyStats = new Map<string, { successes: number; total: number }>();

      for (const event of events) {
        if (event.recoveryStrategy) {
          const stats = strategyStats.get(event.recoveryStrategy) || { successes: 0, total: 0 };
          stats.total++;
          if (event.recoverySuccess) {
            stats.successes++;
          }
          strategyStats.set(event.recoveryStrategy, stats);
        }
      }

      // Convert to array and sort by success rate
      const results = Array.from(strategyStats.entries())
        .map(([strategy, stats]) => ({
          strategy,
          successRate: stats.total > 0 ? stats.successes / stats.total : 0,
          attempts: stats.total,
        }))
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, limit);

      return results;
    } catch (error) {
      console.error('[ReliabilityMetrics] Failed to get top strategies:', error);
      return [];
    }
  }

  /**
   * Get dashboard summary for all reliability layers
   */
  async getDashboardSummary(since?: Date): Promise<{
    phase2: LayerMetrics | null;
    phase3: LayerMetrics | null;
    overall: {
      totalEvents: number;
      totalTriggered: number;
      totalRecovered: number;
    };
  }> {
    try {
      const phase2 = await this.getLayerMetrics('phase2-reproduction', since);
      const phase3 = await this.getLayerMetrics('phase3-loop-detection', since);

      const totalEvents = (phase2?.totalEvents || 0) + (phase3?.totalEvents || 0);
      const totalTriggered = (phase2?.triggeredEvents || 0) + (phase3?.triggeredEvents || 0);
      const totalRecovered = (phase2?.recoverySuccesses || 0) + (phase3?.recoverySuccesses || 0);

      return {
        phase2,
        phase3,
        overall: {
          totalEvents,
          totalTriggered,
          totalRecovered,
        },
      };
    } catch (error) {
      console.error('[ReliabilityMetrics] Failed to get dashboard summary:', error);
      return {
        phase2: null,
        phase3: null,
        overall: {
          totalEvents: 0,
          totalTriggered: 0,
          totalRecovered: 0,
        },
      };
    }
  }
}

// Singleton instance for dependency injection
let metricsInstance: ReliabilityMetrics | null = null;

export function getReliabilityMetrics(prisma?: PrismaClient): ReliabilityMetrics {
  if (!metricsInstance) {
    metricsInstance = new ReliabilityMetrics(prisma);
  }
  return metricsInstance;
}
