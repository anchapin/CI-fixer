/**
 * Docker Monitoring Service
 *
 * Provides centralized monitoring for Docker container resource usage.
 * Implements health checks and resource thresholds as per DRR-2025-12-30-001.
 *
 * Features:
 * - Resource stats aggregation across containers
 * - Health check monitoring with configurable intervals
 * - Threshold-based alerting
 * - Historical metrics tracking (in-memory for now)
 */

import { ResourceStats, RESOURCE_THRESHOLDS } from '../../sandbox.js';

export interface ContainerHealth {
    containerId: string;
    containerName: string;
    healthy: boolean;
    lastCheck: Date;
    stats: ResourceStats | null;
    alerts: string[];
}

export interface MonitoringReport {
    timestamp: Date;
    containers: ContainerHealth[];
    overall: {
        totalContainers: number;
        healthyContainers: number;
        unhealthyContainers: number;
        avgCpuPercent: number;
        avgMemoryPercent: number;
    };
}

/**
 * Docker Monitor Service
 *
 * Singleton service for monitoring Docker containers.
 * Tracks resource usage and health status across all containers.
 */
export class DockerMonitorService {
    private static instance: DockerMonitorService;
    private containers: Map<string, ContainerHealth> = new Map();
    private monitoringInterval: NodeJS.Timeout | null = null;
    private isMonitoring = false;

    private constructor() {}

    /**
     * Get the singleton instance of DockerMonitorService.
     */
    static getInstance(): DockerMonitorService {
        if (!DockerMonitorService.instance) {
            DockerMonitorService.instance = new DockerMonitorService();
        }
        return DockerMonitorService.instance;
    }

    /**
     * Register a container for monitoring.
     *
     * @param containerId Docker container ID
     * @param containerName Human-readable container name
     * @param getSandbox Function to retrieve the sandbox for resource stats
     */
    registerContainer(
        containerId: string,
        containerName: string,
        getSandbox: () => { getResourceStats?: () => Promise<ResourceStats | null> } | null
    ): void {
        const health: ContainerHealth = {
            containerId,
            containerName,
            healthy: true,
            lastCheck: new Date(),
            stats: null,
            alerts: []
        };

        this.containers.set(containerId, { ...health, getSandbox });
        console.log(`[Monitor] Registered container: ${containerName} (${containerId})`);
    }

    /**
     * Unregister a container from monitoring.
     *
     * @param containerId Docker container ID
     */
    unregisterContainer(containerId: string): void {
        this.containers.delete(containerId);
        console.log(`[Monitor] Unregistered container: ${containerId}`);
    }

    /**
     * Check health of a specific container.
     *
     * @param containerId Docker container ID
     * @returns Container health status
     */
    async checkContainerHealth(containerId: string): Promise<ContainerHealth | null> {
        const entry = this.containers.get(containerId);
        if (!entry) return null;

        const getSandbox = (entry as any).getSandbox;
        const sandbox = getSandbox ? getSandbox() : null;
        const stats = sandbox?.getResourceStats ? await sandbox.getResourceStats() : null;

        const alerts: string[] = [];
        let healthy = true;

        if (stats) {
            // Check CPU thresholds
            if (stats.cpuPercent > RESOURCE_THRESHOLDS.CPU_PERCENT_CRITICAL) {
                alerts.push(`CRITICAL: CPU usage ${stats.cpuPercent}% exceeds threshold ${RESOURCE_THRESHOLDS.CPU_PERCENT_CRITICAL}%`);
                healthy = false;
            } else if (stats.cpuPercent > RESOURCE_THRESHOLDS.CPU_PERCENT_WARNING) {
                alerts.push(`WARNING: CPU usage ${stats.cpuPercent}% exceeds threshold ${RESOURCE_THRESHOLDS.CPU_PERCENT_WARNING}%`);
            }

            // Check memory thresholds
            if (stats.memoryPercent > RESOURCE_THRESHOLDS.MEMORY_PERCENT_CRITICAL) {
                alerts.push(`CRITICAL: Memory usage ${stats.memoryPercent.toFixed(1)}% exceeds threshold ${RESOURCE_THRESHOLDS.MEMORY_PERCENT_CRITICAL}%`);
                healthy = false;
            } else if (stats.memoryPercent > RESOURCE_THRESHOLDS.MEMORY_PERCENT_WARNING) {
                alerts.push(`WARNING: Memory usage ${stats.memoryPercent.toFixed(1)}% exceeds threshold ${RESOURCE_THRESHOLDS.MEMORY_PERCENT_WARNING}%`);
            }

            // Check PIDs threshold
            if (stats.pids > RESOURCE_THRESHOLDS.PIDS_CRITICAL) {
                alerts.push(`CRITICAL: PIDs ${stats.pids} exceeds threshold ${RESOURCE_THRESHOLDS.PIDS_CRITICAL}`);
                healthy = false;
            } else if (stats.pids > RESOURCE_THRESHOLDS.PIDS_WARNING) {
                alerts.push(`WARNING: PIDs ${stats.pids} exceeds threshold ${RESOURCE_THRESHOLDS.PIDS_WARNING}`);
            }
        } else {
            alerts.push('Unable to retrieve resource stats');
            healthy = false;
        }

        const health: ContainerHealth = {
            containerId,
            containerName: entry.containerName,
            healthy,
            lastCheck: new Date(),
            stats,
            alerts
        };

        this.containers.set(containerId, { ...health, getSandbox });
        return health;
    }

    /**
     * Generate a monitoring report for all registered containers.
     *
     * @returns Monitoring report with aggregated stats
     */
    async generateReport(): Promise<MonitoringReport> {
        const containers: ContainerHealth[] = [];

        for (const [containerId] of this.containers) {
            const health = await this.checkContainerHealth(containerId);
            if (health) {
                containers.push(health);
            }
        }

        const healthyContainers = containers.filter(c => c.healthy).length;
        const containersWithStats = containers.filter(c => c.stats !== null);

        const avgCpuPercent =
            containersWithStats.length > 0
                ? containersWithStats.reduce((sum, c) => sum + (c.stats?.cpuPercent || 0), 0) / containersWithStats.length
                : 0;

        const avgMemoryPercent =
            containersWithStats.length > 0
                ? containersWithStats.reduce((sum, c) => sum + (c.stats?.memoryPercent || 0), 0) / containersWithStats.length
                : 0;

        return {
            timestamp: new Date(),
            containers,
            overall: {
                totalContainers: containers.length,
                healthyContainers,
                unhealthyContainers: containers.length - healthyContainers,
                avgCpuPercent,
                avgMemoryPercent
            }
        };
    }

    /**
     * Start automatic monitoring with periodic health checks.
     *
     * @param intervalMs Check interval in milliseconds (default: 30s)
     */
    startMonitoring(intervalMs: number = 30000): void {
        if (this.isMonitoring) {
            console.warn('[Monitor] Monitoring already active');
            return;
        }

        this.isMonitoring = true;
        console.log(`[Monitor] Starting monitoring with ${intervalMs}ms interval`);

        this.monitoringInterval = setInterval(async () => {
            try {
                const report = await this.generateReport();

                // Log summary
                console.log(`[Monitor] Health check: ${report.overall.healthyContainers}/${report.overall.totalContainers} healthy, ` +
                    `Avg CPU: ${report.overall.avgCpuPercent.toFixed(1)}%, ` +
                    `Avg Memory: ${report.overall.avgMemoryPercent.toFixed(1)}%`);

                // Log alerts
                for (const container of report.containers) {
                    if (container.alerts.length > 0) {
                        for (const alert of container.alerts) {
                            console.log(`[Monitor] [${container.containerName}] ${alert}`);
                        }
                    }
                }
            } catch (error) {
                console.error('[Monitor] Health check failed:', error);
            }
        }, intervalMs);
    }

    /**
     * Stop automatic monitoring.
     */
    stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.isMonitoring = false;
            console.log('[Monitor] Monitoring stopped');
        }
    }

    /**
     * Get health status for all containers without running a full check.
     *
     * @returns Array of container health statuses
     */
    getAllContainerHealth(): ContainerHealth[] {
        return Array.from(this.containers.values()).map(entry => ({
            containerId: entry.containerId,
            containerName: entry.containerName,
            healthy: entry.healthy,
            lastCheck: entry.lastCheck,
            stats: entry.stats,
            alerts: entry.alerts
        }));
    }
}

// Export singleton instance
export const dockerMonitor = DockerMonitorService.getInstance();
