/**
 * Trajectory Analyzer - Learn from Successful Fixes
 * 
 * Analyzes successful fix attempts to identify optimal tool sequences
 * and create reusable patterns for similar errors
 */

import { CIFixerTool } from '../orchestration/tool-types.js';

export class TrajectoryAnalyzer {
    private db: any;

    constructor(dbClient?: any) {
        this.db = dbClient;
    }

    /**
     * Find the optimal tool sequence for a given error type
     */
    async findOptimalPath(errorCategory: string, complexity: number): Promise<CIFixerTool[] | null> {
        if (!this.db) {
            return null;
        }

        try {
            // Find most successful trajectories for this error type
            // Allow some flexibility in complexity (±2)
            const trajectories = await this.db.fixTrajectory.findMany({
                where: {
                    errorCategory,
                    complexity: {
                        gte: Math.max(1, complexity - 2),
                        lte: Math.min(10, complexity + 2)
                    },
                    success: true
                },
                orderBy: [
                    { reward: 'desc' },
                    { occurrenceCount: 'desc' }
                ],
                take: 5
            });

            if (trajectories.length === 0) {
                return null;
            }

            // Return the best trajectory
            return JSON.parse(trajectories[0].toolSequence);
        } catch (error) {
            console.warn('[TrajectoryAnalyzer] Error finding optimal path:', error);
            return null;
        }
    }

    /**
     * Record a trajectory for future learning
     */
    async recordTrajectory(
        errorCategory: string,
        complexity: number,
        tools: CIFixerTool[],
        success: boolean,
        cost: number,
        latency: number,
        reward: number
    ): Promise<void> {
        if (!this.db) {
            return;
        }

        try {
            const toolSequence = JSON.stringify(tools);

            // Check if this exact trajectory exists
            const existing = await this.db.fixTrajectory.findFirst({
                where: {
                    errorCategory,
                    complexity,
                    toolSequence
                }
            });

            if (existing) {
                // Update existing trajectory with running averages
                const newCount = existing.occurrenceCount + 1;
                await this.db.fixTrajectory.update({
                    where: { id: existing.id },
                    data: {
                        occurrenceCount: newCount,
                        lastUsed: new Date(),
                        // Update running averages
                        totalCost: (existing.totalCost * existing.occurrenceCount + cost) / newCount,
                        totalLatency: (existing.totalLatency * existing.occurrenceCount + latency) / newCount,
                        reward: (existing.reward * existing.occurrenceCount + reward) / newCount
                    }
                });
            } else {
                // Create new trajectory
                await this.db.fixTrajectory.create({
                    data: {
                        errorCategory,
                        complexity,
                        toolSequence,
                        success,
                        totalCost: cost,
                        totalLatency: latency,
                        reward
                    }
                });
            }
        } catch (error) {
            console.error('[TrajectoryAnalyzer] Error recording trajectory:', error);
        }
    }

    /**
     * Get statistics for a specific error category
     */
    async getStats(errorCategory: string): Promise<{
        totalAttempts: number;
        successRate: number;
        avgCost: number;
        avgLatency: number;
    } | null> {
        if (!this.db) {
            return null;
        }

        try {
            const trajectories = await this.db.fixTrajectory.findMany({
                where: { errorCategory }
            });

            if (trajectories.length === 0) {
                return null;
            }

            const totalAttempts = trajectories.reduce((sum, t) => sum + t.occurrenceCount, 0);
            const successfulAttempts = trajectories
                .filter(t => t.success)
                .reduce((sum, t) => sum + t.occurrenceCount, 0);

            const avgCost = trajectories.reduce((sum, t) => sum + t.totalCost * t.occurrenceCount, 0) / totalAttempts;
            const avgLatency = trajectories.reduce((sum, t) => sum + t.totalLatency * t.occurrenceCount, 0) / totalAttempts;

            return {
                totalAttempts,
                successRate: successfulAttempts / totalAttempts,
                avgCost,
                avgLatency
            };
        } catch (error) {
            console.warn('[TrajectoryAnalyzer] Error getting stats:', error);
            return null;
        }
    }
}
