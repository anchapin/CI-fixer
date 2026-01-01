/**
 * Monitoring Module
 *
 * Centralized monitoring services for CI-Fixer infrastructure.
 * Provides Docker container monitoring, health checks, resource tracking,
 * and test reliability monitoring.
 *
 * @module services/monitoring
 */

export { DockerMonitorService, dockerMonitor } from './DockerMonitor.js';
export type { ContainerHealth, MonitoringReport } from './DockerMonitor.js';

export { TestReliabilityMonitor, testReliabilityMonitor } from './TestReliabilityMonitor.js';
export type { TestResult, TestFileMetrics, ReliabilityReport } from './TestReliabilityMonitor.js';
