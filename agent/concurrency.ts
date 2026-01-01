/**
 * Concurrency Control Configuration
 *
 * This module provides centralized configuration for controlling the number
 * of concurrent agent executions to prevent resource exhaustion and crashes.
 *
 * See: DRR-2025-12-30-001 (Reduce Concurrency and Docker Resource Allocation)
 */

/**
 * Maximum number of agents that can run concurrently.
 *
 * Set to 1 (single workflow at a time) as per DRR-2025-12-30-001
 * to prevent Internal Server Error crashes from resource exhaustion.
 *
 * Can be safely incremented (1→2→3→4) after:
 * - Single workflow execution is stable
 * - Resource monitoring shows headroom (CPU < 80%, memory stable)
 * - No crashes for 1+ week
 *
 * TODO: Use monitoring data to determine optimal safe concurrency level
 */
export const MAX_CONCURRENT_AGENTS = parseInt(process.env.MAX_CONCURRENT_AGENTS || '1');

/**
 * Queue timeout in milliseconds.
 * If an agent waits longer than this in the queue, it will be rejected.
 */
export const QUEUE_TIMEOUT_MS = parseInt(process.env.QUEUE_TIMEOUT_MS || '300000'); // 5 minutes default

/**
 * Health check interval in milliseconds.
 * How often to check resource usage of running containers.
 */
export const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000'); // 30 seconds

/**
 * Resource thresholds for health monitoring.
 * If these thresholds are exceeded, alerts should be triggered.
 */
export const RESOURCE_THRESHOLDS = {
    CPU_PERCENT_WARNING: 70,
    CPU_PERCENT_CRITICAL: 90,
    MEMORY_PERCENT_WARNING: 70,
    MEMORY_PERCENT_CRITICAL: 90,
    PIDS_WARNING: 800,
    PIDS_CRITICAL: 950
} as const;

/**
 * Validate if we can safely increase concurrency.
 *
 * @param currentResourceStats Current resource usage statistics
 * @returns true if safe to increase concurrency, false otherwise
 */
export function canIncreaseConcurrency(currentResourceStats: {
    cpuPercent: number;
    memoryPercent: number;
    pids: number;
}): boolean {
    const { CPU_PERCENT_WARNING, MEMORY_PERCENT_WARNING, PIDS_WARNING } = RESOURCE_THRESHOLDS;

    return (
        currentResourceStats.cpuPercent < CPU_PERCENT_WARNING &&
        currentResourceStats.memoryPercent < MEMORY_PERCENT_WARNING &&
        currentResourceStats.pids < PIDS_WARNING
    );
}

/**
 * Calculate recommended concurrency level based on resource usage.
 *
 * @param currentResourceStats Current resource usage statistics
 * @returns Recommended concurrency level (1-4)
 */
export function calculateRecommendedConcurrency(currentResourceStats: {
    cpuPercent: number;
    memoryPercent: number;
    pids: number;
}): number {
    // Critical: Stay at 1
    if (
        currentResourceStats.cpuPercent > RESOURCE_THRESHOLDS.CPU_PERCENT_CRITICAL ||
        currentResourceStats.memoryPercent > RESOURCE_THRESHOLDS.MEMORY_PERCENT_CRITICAL ||
        currentResourceStats.pids > RESOURCE_THRESHOLDS.PIDS_CRITICAL
    ) {
        return 1;
    }

    // Warning: Can go to 2
    if (
        currentResourceStats.cpuPercent > RESOURCE_THRESHOLDS.CPU_PERCENT_WARNING ||
        currentResourceStats.memoryPercent > RESOURCE_THRESHOLDS.MEMORY_PERCENT_WARNING ||
        currentResourceStats.pids > RESOURCE_THRESHOLDS.PIDS_WARNING
    ) {
        return 2;
    }

    // Healthy (< 70% usage): Can go to 3-4
    // Start with 3 as a safe middle ground
    return 3;
}
