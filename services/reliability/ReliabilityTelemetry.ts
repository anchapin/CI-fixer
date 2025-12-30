/**
 * ReliabilityTelemetry Service
 *
 * Records telemetry data for reliability layer activations.
 * This provides the foundation for adaptive thresholds and recovery strategy optimization.
 *
 * Phase 1 Enhancement: Telemetry & Observability
 */

import { PrismaClient } from '@prisma/client';

export interface ReliabilityEventContext {
  // For Phase 2: Reproduction-First Workflow
  reproductionCommand?: string;
  filePath?: string;
  errorType?: string;

  // For Phase 3: Strategy Loop Detection
  complexity?: number;
  complexityHistory?: number[];
  iteration?: number;
  divergingCount?: number;

  // Common fields
  agentRunId?: string;
  groupId?: string;
  errorSummary?: string;
}

export interface ReliabilityEventData {
  layer: 'phase2-reproduction' | 'phase3-loop-detection';
  triggered: boolean;
  threshold: number;
  context: ReliabilityEventContext;
  outcome?: 'recovered' | 'failed' | 'human-intervention';
  recoveryAttempted?: boolean;
  recoveryStrategy?: string;
  recoverySuccess?: boolean;
}

export class ReliabilityTelemetry {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient = new PrismaClient()) {
    this.prisma = prisma;
  }

  /**
   * Record a reliability layer activation event
   */
  async recordEvent(event: ReliabilityEventData): Promise<void> {
    try {
      await this.prisma.reliabilityEvent.create({
        data: {
          layer: event.layer,
          triggered: event.triggered,
          threshold: event.threshold,
          context: JSON.stringify(event.context),
          outcome: event.outcome || 'pending',
          recoveryAttempted: event.recoveryAttempted || false,
          recoveryStrategy: event.recoveryStrategy,
          recoverySuccess: event.recoverySuccess,
          agentRunId: event.context?.agentRunId,
        },
      });
    } catch (error) {
      // Log but don't throw - telemetry failures shouldn't break the agent
      console.error('[ReliabilityTelemetry] Failed to record event:', error);
    }
  }

  /**
   * Record multiple reliability layer activation events in a single batch operation
   * This is significantly more efficient than calling recordEvent multiple times
   */
  async recordEvents(events: ReliabilityEventData[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      await this.prisma.reliabilityEvent.createMany({
        data: events.map((event) => ({
          layer: event.layer,
          triggered: event.triggered,
          threshold: event.threshold,
          context: JSON.stringify(event.context),
          outcome: event.outcome || 'pending',
          recoveryAttempted: event.recoveryAttempted || false,
          recoveryStrategy: event.recoveryStrategy,
          recoverySuccess: event.recoverySuccess,
          agentRunId: event.context?.agentRunId,
        })),
      });
    } catch (error) {
      // Log but don't throw - telemetry failures shouldn't break the agent
      console.error('[ReliabilityTelemetry] Failed to record events:', error);
    }
  }

  /**
   * Record Phase 2: Reproduction-First Workflow trigger
   */
  async recordReproductionRequired(
    context: ReliabilityEventContext,
    threshold: number = 1
  ): Promise<void> {
    await this.recordEvent({
      layer: 'phase2-reproduction',
      triggered: true,
      threshold,
      context,
      outcome: 'pending', // Will be updated when recovery is attempted
    });
  }

  /**
   * Record Phase 3: Strategy Loop Detection trigger
   */
  async recordStrategyLoopDetected(
    context: ReliabilityEventContext,
    threshold: number
  ): Promise<void> {
    await this.recordEvent({
      layer: 'phase3-loop-detection',
      triggered: true,
      threshold,
      context,
      outcome: 'pending',
    });
  }

  /**
   * Update event outcome when recovery is attempted
   */
  async updateRecoveryOutcome(
    eventId: string,
    strategy: string,
    success: boolean
  ): Promise<void> {
    try {
      await this.prisma.reliabilityEvent.update({
        where: { id: eventId },
        data: {
          recoveryAttempted: true,
          recoveryStrategy: strategy,
          recoverySuccess: success,
          outcome: success ? 'recovered' : 'failed',
        },
      });
    } catch (error) {
      console.error('[ReliabilityTelemetry] Failed to update event:', error);
    }
  }

  /**
   * Get recent events for a specific layer
   */
  async getRecentEvents(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    limit: number = 100
  ): Promise<any[]> {
    try {
      return await this.prisma.reliabilityEvent.findMany({
        where: { layer },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.error('[ReliabilityTelemetry] Failed to fetch events:', error);
      return [];
    }
  }

  /**
   * Get trigger rate for a layer (percentage of runs that triggered the layer)
   */
  async getTriggerRate(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    since?: Date
  ): Promise<number> {
    try {
      const where: any = { layer };
      if (since) {
        where.createdAt = { gte: since };
      }

      const total = await this.prisma.reliabilityEvent.count({ where });
      const triggered = await this.prisma.reliabilityEvent.count({
        where: { ...where, triggered: true },
      });

      return total > 0 ? triggered / total : 0;
    } catch (error) {
      console.error('[ReliabilityTelemetry] Failed to calculate trigger rate:', error);
      return 0;
    }
  }

  /**
   * Get recovery success rate for a layer
   */
  async getRecoverySuccessRate(
    layer: 'phase2-reproduction' | 'phase3-loop-detection',
    since?: Date
  ): Promise<number> {
    try {
      const where: any = {
        layer,
        recoveryAttempted: true,
      };
      if (since) {
        where.createdAt = { gte: since };
      }

      const total = await this.prisma.reliabilityEvent.count({ where });
      const successful = await this.prisma.reliabilityEvent.count({
        where: { ...where, recoverySuccess: true },
      });

      return total > 0 ? successful / total : 0;
    } catch (error) {
      console.error('[ReliabilityTelemetry] Failed to calculate recovery rate:', error);
      return 0;
    }
  }

  /**
   * Delete old events (cleanup for data retention)
   */
  async deleteOldEvents(daysToKeep: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await this.prisma.reliabilityEvent.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });

      return result.count;
    } catch (error) {
      console.error('[ReliabilityTelemetry] Failed to delete old events:', error);
      return 0;
    }
  }
}

// Singleton instance for dependency injection
let telemetryInstance: ReliabilityTelemetry | null = null;

export function getReliabilityTelemetry(prisma?: PrismaClient): ReliabilityTelemetry {
  if (!telemetryInstance) {
    telemetryInstance = new ReliabilityTelemetry(prisma);
  }
  return telemetryInstance;
}
