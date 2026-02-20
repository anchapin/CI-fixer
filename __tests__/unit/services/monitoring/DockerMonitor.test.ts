/**
 * Tests for DockerMonitor service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DockerMonitorService, ContainerHealth, MonitoringReport } from '../../../../services/monitoring/DockerMonitor';

describe('DockerMonitorService', () => {
    let monitor: DockerMonitorService;

    beforeEach(() => {
        // Create a fresh instance for each test
        monitor = new DockerMonitorService();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        monitor.stopMonitoring();
        vi.restoreAllMocks();
    });

    describe('getInstance', () => {
        it('should return singleton instance', () => {
            const instance1 = DockerMonitorService.getInstance();
            const instance2 = DockerMonitorService.getInstance();
            expect(instance1).toBe(instance2);
        });
    });

    describe('registerContainer', () => {
        it('should register a container', () => {
            monitor.registerContainer('container-123', 'test-container', () => null);

            const health = monitor.getAllContainerHealth();
            expect(health).toHaveLength(1);
            expect(health[0].containerId).toBe('container-123');
            expect(health[0].containerName).toBe('test-container');
            expect(health[0].healthy).toBe(true);
            expect(health[0].stats).toBeNull();
            expect(health[0].alerts).toEqual([]);
        });

        it('should register multiple containers', () => {
            monitor.registerContainer('container-1', 'container-1', () => null);
            monitor.registerContainer('container-2', 'container-2', () => null);
            monitor.registerContainer('container-3', 'container-3', () => null);

            const health = monitor.getAllContainerHealth();
            expect(health).toHaveLength(3);
        });

        it('should allow updating existing container', () => {
            monitor.registerContainer('container-1', 'original-name', () => null);
            monitor.registerContainer('container-1', 'updated-name', () => null);

            const health = monitor.getAllContainerHealth();
            expect(health).toHaveLength(1);
            expect(health[0].containerName).toBe('updated-name');
        });
    });

    describe('unregisterContainer', () => {
        it('should unregister an existing container', () => {
            monitor.registerContainer('container-1', 'test', () => null);
            expect(monitor.getAllContainerHealth()).toHaveLength(1);

            monitor.unregisterContainer('container-1');
            expect(monitor.getAllContainerHealth()).toHaveLength(0);
        });

        it('should handle unregistering non-existent container', () => {
            monitor.unregisterContainer('non-existent');
            expect(monitor.getAllContainerHealth()).toHaveLength(0);
        });

        it('should handle unregistering from empty monitor', () => {
            monitor.unregisterContainer('any-id');
            expect(monitor.getAllContainerHealth()).toHaveLength(0);
        });
    });

    describe('checkContainerHealth', () => {
        it('should return null for unregistered container', async () => {
            const health = await monitor.checkContainerHealth('non-existent');
            expect(health).toBeNull();
        });

        it('should return healthy status for container without stats', async () => {
            monitor.registerContainer('container-1', 'test', () => null);

            const health = await monitor.checkContainerHealth('container-1');
            expect(health).not.toBeNull();
            expect(health!.healthy).toBe(false);
            expect(health!.alerts).toContain('Unable to retrieve resource stats');
            expect(health!.stats).toBeNull();
        });

        it('should mark container as unhealthy on critical CPU', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 95,
                    memoryPercent: 50,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(false);
            expect(health!.alerts.some(a => a.includes('CRITICAL: CPU'))).toBe(true);
        });

        it('should warn on high but not critical CPU', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 85,
                    memoryPercent: 50,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(true);
            expect(health!.alerts.some(a => a.includes('WARNING: CPU'))).toBe(true);
        });

        it('should mark container as unhealthy on critical memory', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 50,
                    memoryPercent: 95,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(false);
            expect(health!.alerts.some(a => a.includes('CRITICAL: Memory'))).toBe(true);
        });

        it('should warn on high but not critical memory', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 50,
                    memoryPercent: 85,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(true);
            expect(health!.alerts.some(a => a.includes('WARNING: Memory'))).toBe(true);
        });

        it('should mark container as unhealthy on critical PIDs', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 50,
                    memoryPercent: 50,
                    pids: 2000
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(false);
            expect(health!.alerts.some(a => a.includes('CRITICAL: PIDs'))).toBe(true);
        });

        it('should warn on high but not critical PIDs', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 50,
                    memoryPercent: 50,
                    pids: 875  // Between WARNING (800) and CRITICAL (950)
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(true);
            expect(health!.alerts.some(a => a.includes('WARNING: PIDs'))).toBe(true);
        });

        it('should report healthy for all normal metrics', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 30,
                    memoryPercent: 40,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.healthy).toBe(true);
            expect(health!.alerts).toEqual([]);
            expect(health!.stats).toEqual({
                cpuPercent: 30,
                memoryPercent: 40,
                pids: 100
            });
        });

        it('should update lastCheck timestamp', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 30,
                    memoryPercent: 40,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'test', () => mockSandbox);
            const beforeCheck = new Date();
            await new Promise(resolve => setTimeout(resolve, 10));
            const health = await monitor.checkContainerHealth('container-1');

            expect(health!.lastCheck.getTime()).toBeGreaterThanOrEqual(beforeCheck.getTime());
        });
    });

    describe('generateReport', () => {
        it('should generate empty report when no containers registered', async () => {
            const report = await monitor.generateReport();

            expect(report.containers).toEqual([]);
            expect(report.overall.totalContainers).toBe(0);
            expect(report.overall.healthyContainers).toBe(0);
            expect(report.overall.unhealthyContainers).toBe(0);
            expect(report.overall.avgCpuPercent).toBe(0);
            expect(report.overall.avgMemoryPercent).toBe(0);
        });

        it('should generate report with all containers', async () => {
            const mockSandbox1 = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 30,
                    memoryPercent: 40,
                    pids: 100
                })
            };
            const mockSandbox2 = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 50,
                    memoryPercent: 60,
                    pids: 200
                })
            };

            monitor.registerContainer('container-1', 'test-1', () => mockSandbox1);
            monitor.registerContainer('container-2', 'test-2', () => mockSandbox2);

            const report = await monitor.generateReport();

            expect(report.containers).toHaveLength(2);
            expect(report.overall.totalContainers).toBe(2);
            expect(report.overall.healthyContainers).toBe(2);
            expect(report.overall.unhealthyContainers).toBe(0);
            expect(report.overall.avgCpuPercent).toBeCloseTo(40, 1); // (30 + 50) / 2
            expect(report.overall.avgMemoryPercent).toBeCloseTo(50, 1); // (40 + 60) / 2
        });

        it('should count unhealthy containers correctly', async () => {
            const healthySandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 30,
                    memoryPercent: 40,
                    pids: 100
                })
            };
            const unhealthySandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 95,
                    memoryPercent: 40,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'healthy', () => healthySandbox);
            monitor.registerContainer('container-2', 'unhealthy', () => unhealthySandbox);

            const report = await monitor.generateReport();

            expect(report.overall.totalContainers).toBe(2);
            expect(report.overall.healthyContainers).toBe(1);
            expect(report.overall.unhealthyContainers).toBe(1);
        });

        it('should handle containers with null stats in average calculation', async () => {
            const mockSandbox = {
                getResourceStats: vi.fn().mockResolvedValue({
                    cpuPercent: 30,
                    memoryPercent: 40,
                    pids: 100
                })
            };

            monitor.registerContainer('container-1', 'with-stats', () => mockSandbox);
            monitor.registerContainer('container-2', 'without-stats', () => null);

            const report = await monitor.generateReport();

            // Average should only consider containers with stats
            expect(report.overall.avgCpuPercent).toBe(30);
            expect(report.overall.avgMemoryPercent).toBe(40);
        });

        it('should include timestamp in report', async () => {
            const beforeReport = new Date();
            const report = await monitor.generateReport();
            const afterReport = new Date();

            expect(report.timestamp.getTime()).toBeGreaterThanOrEqual(beforeReport.getTime());
            expect(report.timestamp.getTime()).toBeLessThanOrEqual(afterReport.getTime());
        });
    });

    describe('startMonitoring/stopMonitoring', () => {
        it('should start monitoring with default interval', () => {
            monitor.startMonitoring();

            expect(monitor.getAllContainerHealth()).toBeDefined();
        });

        it('should start monitoring with custom interval', () => {
            monitor.startMonitoring(10000);

            expect(monitor.getAllContainerHealth()).toBeDefined();
        });

        it('should warn if already monitoring', () => {
            monitor.startMonitoring();
            monitor.startMonitoring();

            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('already active'));
        });

        it('should stop monitoring', () => {
            monitor.startMonitoring();
            expect(monitor.getAllContainerHealth()).toBeDefined();

            monitor.stopMonitoring();
        });

        it('should handle stopping when not monitoring', () => {
            monitor.stopMonitoring(); // Should not throw
        });

        it('should restart monitoring after stop', () => {
            monitor.startMonitoring();
            monitor.stopMonitoring();
            monitor.startMonitoring();

            expect(monitor.getAllContainerHealth()).toBeDefined();
        });
    });

    describe('getAllContainerHealth', () => {
        it('should return empty array when no containers registered', () => {
            const health = monitor.getAllContainerHealth();
            expect(health).toEqual([]);
        });

        it('should return all registered containers', () => {
            monitor.registerContainer('container-1', 'test-1', () => null);
            monitor.registerContainer('container-2', 'test-2', () => null);

            const health = monitor.getAllContainerHealth();
            expect(health).toHaveLength(2);
        });

        it('should return containers without internal getSandbox property', () => {
            monitor.registerContainer('container-1', 'test', () => null);

            const health = monitor.getAllContainerHealth();
            expect(health[0]).not.toHaveProperty('getSandbox');
        });
    });
});
