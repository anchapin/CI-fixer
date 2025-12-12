import { db as prisma } from '../db/client.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface MetricsSummary {
    totalRuns: number;
    successRate: number;
    avgIterations: number;
    avgTimeToFixMs: number;
    byCategory: Record<string, {
        count: number;
        successRate: number;
        avgIterations: number;
    }>;
}

export interface CategoryMetrics {
    category: string;
    count: number;
    successRate: number;
    avgIterations: number;
    avgTimeToFixMs: number;
}

// ============================================================================
// METRICS COLLECTION
// ============================================================================

/**
 * Records a single fix attempt during an agent iteration.
 * Used to track granular metrics for each action taken.
 */
export async function recordFixAttempt(
    runId: string,
    iteration: number,
    action: string,
    success: boolean,
    durationMs: number,
    filesChanged: string[]
): Promise<void> {
    await prisma.fixAttempt.create({
        data: {
            runId,
            iteration,
            action,
            success,
            durationMs,
            filesChanged: JSON.stringify(filesChanged)
        }
    });
}

/**
 * Records overall agent run metrics after completion.
 * Calculates success rate based on final status.
 */
export async function recordAgentMetrics(
    runId: string,
    finalStatus: 'success' | 'failed' | 'partial',
    iterationCount: number,
    totalTimeMs: number,
    errorCategory: string
): Promise<void> {
    const successRate = finalStatus === 'success' ? 1.0 :
        finalStatus === 'partial' ? 0.5 : 0.0;

    await prisma.agentMetrics.create({
        data: {
            runId,
            successRate,
            iterationCount,
            timeToFixMs: totalTimeMs,
            errorCategory
        }
    });
}

// ============================================================================
// METRICS AGGREGATION
// ============================================================================

/**
 * Gets comprehensive metrics summary across all runs.
 * Includes overall stats and breakdown by error category.
 */
export async function getMetricsSummary(): Promise<MetricsSummary> {
    const allMetrics = await prisma.agentMetrics.findMany();

    if (allMetrics.length === 0) {
        return {
            totalRuns: 0,
            successRate: 0,
            avgIterations: 0,
            avgTimeToFixMs: 0,
            byCategory: {}
        };
    }

    const totalRuns = allMetrics.length;
    const successRate = allMetrics.reduce((sum, m) => sum + m.successRate, 0) / totalRuns;
    const avgIterations = allMetrics.reduce((sum, m) => sum + m.iterationCount, 0) / totalRuns;
    const avgTimeToFixMs = allMetrics.reduce((sum, m) => sum + m.timeToFixMs, 0) / totalRuns;

    // Group by category
    const categoryMap = new Map<string, typeof allMetrics>();
    for (const metric of allMetrics) {
        if (!categoryMap.has(metric.errorCategory)) {
            categoryMap.set(metric.errorCategory, []);
        }
        categoryMap.get(metric.errorCategory)!.push(metric);
    }

    const byCategory: Record<string, any> = {};
    for (const [category, metrics] of categoryMap.entries()) {
        byCategory[category] = {
            count: metrics.length,
            successRate: metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length,
            avgIterations: metrics.reduce((sum, m) => sum + m.iterationCount, 0) / metrics.length
        };
    }

    return {
        totalRuns,
        successRate,
        avgIterations,
        avgTimeToFixMs,
        byCategory
    };
}

/**
 * Gets metrics for a specific error category.
 * Useful for analyzing patterns in specific types of failures.
 */
export async function getMetricsByCategory(
    category: string,
    limit: number = 10
): Promise<CategoryMetrics | null> {
    const metrics = await prisma.agentMetrics.findMany({
        where: { errorCategory: category },
        orderBy: { createdAt: 'desc' },
        take: limit
    });

    if (metrics.length === 0) {
        return null;
    }

    return {
        category,
        count: metrics.length,
        successRate: metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length,
        avgIterations: metrics.reduce((sum, m) => sum + m.iterationCount, 0) / metrics.length,
        avgTimeToFixMs: metrics.reduce((sum, m) => sum + m.timeToFixMs, 0) / metrics.length
    };
}

/**
 * Gets recent agent runs with their metrics.
 */
export async function getRecentMetrics(limit: number = 10) {
    return await prisma.agentMetrics.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
            agentRun: {
                select: {
                    groupId: true,
                    status: true
                }
            }
        }
    });
}

/**
 * Gets all fix attempts for a specific run.
 * Useful for analyzing iteration-by-iteration performance.
 */
export async function getFixAttemptsForRun(runId: string) {
    const attempts = await prisma.fixAttempt.findMany({
        where: { runId },
        orderBy: { iteration: 'asc' }
    });

    return attempts.map(attempt => ({
        ...attempt,
        filesChanged: JSON.parse(attempt.filesChanged) as string[]
    }));
}
