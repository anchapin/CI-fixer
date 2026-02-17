/**
 * Test Reliability Monitoring Service
 *
 * Tracks test execution results and provides reliability metrics.
 * Maintains 99.7% pass rate target as per DRR-2025-12-30-001 Phase 2.
 *
 * Features:
 * - Test result tracking (pass/fail/skip)
 * - Reliability metrics calculation
 * - Flaky test detection
 * - Historical trend analysis
 * - Alert generation for reliability degradation
 */

export interface TestResult {
    testFile: string;
    testName: string;
    status: 'pass' | 'fail' | 'skip' | 'timeout';
    duration: number;
    timestamp: Date;
    error?: string;
}

export interface TestFileMetrics {
    testFile: string;
    totalRuns: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    avgDuration: number;
    lastRun: Date;
    flakyScore: number; // 0-100, higher = more flaky
}

export interface ReliabilityReport {
    timestamp: Date;
    totalTests: number;
    totalRuns: number;
    passed: number;
    failed: number;
    skipped: number;
    overallPassRate: number;
    targetPassRate: number;
    meetsTarget: boolean;
    testFiles: TestFileMetrics[];
    flakyTests: string[];
    degradedTests: string[]; // Tests with declining pass rates
    improvements: string[]; // Tests with improving pass rates
}

/**
 * Test Reliability Monitor
 *
 * Singleton service for tracking and analyzing test reliability.
 */
export class TestReliabilityMonitor {
    private static instance: TestReliabilityMonitor;
    private testResults: Map<string, TestResult[]> = new Map();
    private historicalSnapshots: ReliabilityReport[] = [];
    private targetPassRate = 0.997; // 99.7% target

    private constructor() {}

    static getInstance(): TestReliabilityMonitor {
        if (!TestReliabilityMonitor.instance) {
            TestReliabilityMonitor.instance = new TestReliabilityMonitor();
        }
        return TestReliabilityMonitor.instance;
    }

    /**
     * Record test results from a test run.
     *
     * @param testResults Array of test results
     */
    recordResults(results: TestResult[]): void {
        for (const result of results) {
            const key = `${result.testFile}::${result.testName}`;
            if (!this.testResults.has(key)) {
                this.testResults.set(key, []);
            }
            this.testResults.get(key)!.push(result);

            // Keep only last 100 results per test to manage memory
            const history = this.testResults.get(key)!;
            if (history.length > 100) {
                history.shift();
            }
        }
    }

    /**
     * Calculate reliability metrics for a specific test file.
     *
     * @param testFile Test file path
     * @returns Test file metrics
     */
    getFileMetrics(testFile: string): TestFileMetrics | null {
        const fileResults: TestResult[] = [];

        for (const [key, results] of this.testResults) {
            if (key.startsWith(`${testFile}::`)) {
                fileResults.push(...results);
            }
        }

        if (fileResults.length === 0) return null;

        const passed = fileResults.filter(r => r.status === 'pass').length;
        const failed = fileResults.filter(r => r.status === 'fail' || r.status === 'timeout').length;
        const skipped = fileResults.filter(r => r.status === 'skip').length;
        const totalRuns = fileResults.length;

        const passRate = totalRuns > 0 ? passed / totalRuns : 0;
        const avgDuration = fileResults.reduce((sum, r) => sum + r.duration, 0) / totalRuns;
        const lastRun = new Date(Math.max(...fileResults.map(r => r.timestamp.getTime())));

        // Calculate flaky score (0-100)
        // A test is flaky if it has both passes and fails
        const hasPasses = passed > 0;
        const hasFails = failed > 0;
        let flakyScore = 0;
        if (hasPasses && hasFails) {
            // More variation = higher flaky score
            const failRate = failed / totalRuns;
            flakyScore = Math.min(100, failRate * 200); // Scale up for visibility
        }

        return {
            testFile,
            totalRuns,
            passed,
            failed,
            skipped,
            passRate,
            avgDuration,
            lastRun,
            flakyScore
        };
    }

    /**
     * Generate a comprehensive reliability report.
     *
     * @returns Reliability report with metrics and alerts
     */
    generateReport(): ReliabilityReport {
        const allFiles = new Set<string>();
        for (const [key] of this.testResults) {
            const testFile = key.split('::')[0];
            allFiles.add(testFile);
        }

        const testFiles: TestFileMetrics[] = [];
        let totalPassed = 0;
        let totalFailed = 0;
        let totalSkipped = 0;
        let totalRuns = 0;

        for (const testFile of allFiles) {
            const metrics = this.getFileMetrics(testFile);
            if (metrics) {
                testFiles.push(metrics);
                totalPassed += metrics.passed;
                totalFailed += metrics.failed;
                totalSkipped += metrics.skipped;
                totalRuns += metrics.totalRuns;
            }
        }

        const overallPassRate = totalRuns > 0 ? totalPassed / totalRuns : 1;
        const meetsTarget = overallPassRate >= this.targetPassRate;

        // Identify flaky tests (flaky score > 30)
        const flakyTests = testFiles
            .filter(f => f.flakyScore > 30)
            .map(f => `${f.testFile} (${f.flakyScore.toFixed(0)}% flaky)`);

        // Identify tests with declining pass rates (compare to last snapshot)
        const degradedTests: string[] = [];
        const improvements: string[] = [];

        if (this.historicalSnapshots.length > 0) {
            const lastSnapshot = this.historicalSnapshots[this.historicalSnapshots.length - 1];
            const lastMetrics = new Map(lastSnapshot.testFiles.map(f => [f.testFile, f]));

            for (const current of testFiles) {
                const last = lastMetrics.get(current.testFile);
                if (last) {
                    const change = current.passRate - last.passRate;
                    if (change < -0.05) { // Declined by > 5%
                        degradedTests.push(`${current.testFile} (${(change * 100).toFixed(1)}%)`);
                    } else if (change > 0.05) { // Improved by > 5%
                        improvements.push(`${current.testFile} (+${(change * 100).toFixed(1)}%)`);
                    }
                }
            }
        }

        const report: ReliabilityReport = {
            timestamp: new Date(),
            totalTests: allFiles.size,
            totalRuns,
            passed: totalPassed,
            failed: totalFailed,
            skipped: totalSkipped,
            overallPassRate,
            targetPassRate: this.targetPassRate,
            meetsTarget,
            testFiles,
            flakyTests,
            degradedTests,
            improvements
        };

        // Store snapshot for trend analysis
        this.historicalSnapshots.push(report);
        if (this.historicalSnapshots.length > 100) {
            this.historicalSnapshots.shift();
        }

        return report;
    }

    /**
     * Get flaky tests that need attention.
     *
     * @param threshold Flaky score threshold (default: 30)
     * @returns Array of flaky test file names
     */
    getFlakyTests(threshold: number = 30): string[] {
        const report = this.generateReport();
        return report.flakyTests.filter(t => {
            const score = parseFloat(t.match(/\((\d+)%/)?.[1] || '0');
            return score >= threshold;
        });
    }

    /**
     * Get reliability trend over time.
     *
     * @param limit Number of historical snapshots to include (default: 10)
     * @returns Array of historical reports
     */
    getTrend(limit: number = 10): ReliabilityReport[] {
        return this.historicalSnapshots.slice(-limit);
    }

    /**
     * Check if reliability target is met and generate alerts if not.
     *
     * @returns Alert messages or empty array if all good
     */
    checkReliability(): string[] {
        const report = this.generateReport();
        const alerts: string[] = [];

        // Check overall pass rate
        if (!report.meetsTarget) {
            alerts.push(
                `⚠️ PASS RATE BELOW TARGET: ${(report.overallPassRate * 100).toFixed(2)}% < ${(report.targetPassRate * 100).toFixed(2)}%`
            );
        }

        // Check for flaky tests
        if (report.flakyTests.length > 0) {
            alerts.push(`⚠️ FLAKY TESTS DETECTED: ${report.flakyTests.length} tests show instability`);
        }

        // Check for degraded tests
        if (report.degradedTests.length > 0) {
            alerts.push(`⚠️ DEGRADED TESTS: ${report.degradedTests.length} tests have declining pass rates`);
        }

        // Check for individual test files below threshold
        const belowThreshold = report.testFiles.filter(f => f.passRate < 0.95); // 95% threshold
        if (belowThreshold.length > 0) {
            alerts.push(`⚠️ LOW RELIABILITY: ${belowThreshold.length} test files below 95% pass rate`);
        }

        return alerts;
    }

    /**
     * Export reliability data for CI/CD integration.
     *
     * @returns JSON string with reliability metrics
     */
    exportMetrics(): string {
        const report = this.generateReport();
        return JSON.stringify({
            timestamp: report.timestamp.toISOString(),
            metrics: {
                overallPassRate: report.overallPassRate,
                targetPassRate: report.targetPassRate,
                meetsTarget: report.meetsTarget,
                totalTests: report.totalTests,
                totalRuns: report.totalRuns,
                passed: report.passed,
                failed: report.failed,
                skipped: report.skipped
            },
            flakyTests: report.flakyTests,
            alerts: this.checkReliability()
        }, null, 2);
    }

    /**
     * Set custom pass rate target.
     *
     * @param target Target pass rate (0-1)
     */
    setTargetPassRate(target: number): void {
        if (target < 0 || target > 1) {
            throw new Error('Target pass rate must be between 0 and 1');
        }
        this.targetPassRate = target;
    }

    /**
     * Get current pass rate target.
     */
    getTargetPassRate(): number {
        return this.targetPassRate;
    }

    /**
     * Clear all stored test results (useful for testing).
     */
    clearResults(): void {
        this.testResults.clear();
        this.historicalSnapshots = [];
    }
}

// Export singleton instance
export const testReliabilityMonitor = TestReliabilityMonitor.getInstance();
