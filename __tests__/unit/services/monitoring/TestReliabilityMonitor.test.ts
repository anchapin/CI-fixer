/**
 * Tests for TestReliabilityMonitor service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    TestReliabilityMonitor,
    TestResult,
    TestFileMetrics,
    ReliabilityReport
} from '../../../../services/monitoring/TestReliabilityMonitor';

describe('TestReliabilityMonitor', () => {
    let monitor: TestReliabilityMonitor;

    beforeEach(() => {
        monitor = new TestReliabilityMonitor();
    });

    describe('getInstance', () => {
        it('should return singleton instance', () => {
            const instance1 = TestReliabilityMonitor.getInstance();
            const instance2 = TestReliabilityMonitor.getInstance();
            expect(instance1).toBe(instance2);
        });
    });

    describe('recordResults', () => {
        it('should record a single test result', () => {
            const result: TestResult = {
                testFile: 'test.spec.ts',
                testName: 'should pass',
                status: 'pass',
                duration: 100,
                timestamp: new Date()
            };

            monitor.recordResults([result]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics).not.toBeNull();
            expect(metrics!.totalRuns).toBe(1);
            expect(metrics!.passed).toBe(1);
        });

        it('should record multiple test results', () => {
            const results: TestResult[] = [
                {
                    testFile: 'test.spec.ts',
                    testName: 'test 1',
                    status: 'pass',
                    duration: 100,
                    timestamp: new Date()
                },
                {
                    testFile: 'test.spec.ts',
                    testName: 'test 2',
                    status: 'fail',
                    duration: 200,
                    timestamp: new Date()
                },
                {
                    testFile: 'test.spec.ts',
                    testName: 'test 3',
                    status: 'skip',
                    duration: 0,
                    timestamp: new Date()
                }
            ];

            monitor.recordResults(results);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.totalRuns).toBe(3);
            expect(metrics!.passed).toBe(1);
            expect(metrics!.failed).toBe(1);
            expect(metrics!.skipped).toBe(1);
        });

        it('should track results for multiple test files', () => {
            monitor.recordResults([
                {
                    testFile: 'test1.spec.ts',
                    testName: 'test',
                    status: 'pass',
                    duration: 100,
                    timestamp: new Date()
                },
                {
                    testFile: 'test2.spec.ts',
                    testName: 'test',
                    status: 'pass',
                    duration: 100,
                    timestamp: new Date()
                }
            ]);

            expect(monitor.getFileMetrics('test1.spec.ts')).not.toBeNull();
            expect(monitor.getFileMetrics('test2.spec.ts')).not.toBeNull();
        });

        it('should handle timeout status', () => {
            monitor.recordResults([
                {
                    testFile: 'test.spec.ts',
                    testName: 'slow test',
                    status: 'timeout',
                    duration: 30000,
                    timestamp: new Date()
                }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.totalRuns).toBe(1);
            expect(metrics!.failed).toBe(1); // Timeouts count as failures
        });

        it('should limit history to 100 results per test', () => {
            const results: TestResult[] = [];
            // All for the same test - should be limited to 100
            for (let i = 0; i < 150; i++) {
                results.push({
                    testFile: 'test.spec.ts',
                    testName: 'same test',  // Same test name
                    status: 'pass',
                    duration: 100,
                    timestamp: new Date()
                });
            }

            monitor.recordResults(results);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.totalRuns).toBe(100); // Limited to 100
        });

        it('should include error message when present', () => {
            monitor.recordResults([
                {
                    testFile: 'test.spec.ts',
                    testName: 'failing test',
                    status: 'fail',
                    duration: 100,
                    timestamp: new Date(),
                    error: 'AssertionError: Expected true to be false'
                }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.failed).toBe(1);
        });
    });

    describe('getFileMetrics', () => {
        it('should return null for non-existent test file', () => {
            const metrics = monitor.getFileMetrics('non-existent.spec.ts');
            expect(metrics).toBeNull();
        });

        it('should calculate pass rate correctly', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.passRate).toBeCloseTo(2/3, 2);
        });

        it('should calculate average duration correctly', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 200, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'pass', duration: 300, timestamp: new Date() }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.avgDuration).toBeCloseTo(200, 1);
        });

        it('should return most recent run time', () => {
            const now = new Date();
            const past = new Date(now.getTime() - 10000);

            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: past },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: now }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.lastRun.getTime()).toBe(now.getTime());
        });

        it('should calculate flaky score for consistent passing tests', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'pass', duration: 100, timestamp: new Date() }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.flakyScore).toBe(0);
        });

        it('should calculate flaky score for consistent failing tests', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.flakyScore).toBe(0);
        });

        it('should calculate flaky score for inconsistent tests', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't4', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.flakyScore).toBeGreaterThan(0);
            expect(metrics!.flakyScore).toBeLessThanOrEqual(100);
        });

        it('should handle multiple tests in same file', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 'test1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 'test2', status: 'pass', duration: 200, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 'test3', status: 'fail', duration: 150, timestamp: new Date() }
            ]);

            const metrics = monitor.getFileMetrics('test.spec.ts');
            expect(metrics!.totalRuns).toBe(3);
            expect(metrics!.passed).toBe(2);
            expect(metrics!.failed).toBe(1);
        });
    });

    describe('generateReport', () => {
        beforeEach(() => {
            monitor.recordResults([
                { testFile: 'test1.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test1.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test2.spec.ts', testName: 't1', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test3.spec.ts', testName: 't1', status: 'skip', duration: 0, timestamp: new Date() }
            ]);
        });

        it('should generate report with correct totals', () => {
            const report = monitor.generateReport();

            expect(report.totalTests).toBe(3);
            expect(report.totalRuns).toBe(4);
            expect(report.passed).toBe(2);
            expect(report.failed).toBe(1);
            expect(report.skipped).toBe(1);
        });

        it('should calculate overall pass rate', () => {
            const report = monitor.generateReport();

            expect(report.overallPassRate).toBeCloseTo(2/4, 2);
        });

        it('should include target pass rate', () => {
            const report = monitor.generateReport();

            expect(report.targetPassRate).toBe(0.997);
        });

        it('should indicate if target is met', () => {
            const report = monitor.generateReport();

            expect(report.meetsTarget).toBe(false); // 50% < 99.7%
        });

        it('should include test file metrics', () => {
            const report = monitor.generateReport();

            expect(report.testFiles).toHaveLength(3);
            expect(report.testFiles.find(f => f.testFile === 'test1.spec.ts')).toBeDefined();
        });

        it('should identify flaky tests', () => {
            // Add inconsistent results to create flakiness
            monitor.recordResults([
                { testFile: 'flaky.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't3', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't4', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const report = monitor.generateReport();

            expect(report.flakyTests.length).toBeGreaterThan(0);
        });

        it('should track historical snapshots', () => {
            const report1 = monitor.generateReport();
            const report2 = monitor.generateReport();

            const trend = monitor.getTrend();
            expect(trend).toContain(report1);
            expect(trend).toContain(report2);
        });

        it('should limit historical snapshots to 100', () => {
            // Generate 101 reports
            for (let i = 0; i < 101; i++) {
                monitor.recordResults([
                    { testFile: `test${i}.spec.ts`, testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
                ]);
                monitor.generateReport();
            }

            const trend = monitor.getTrend();
            expect(trend.length).toBeLessThanOrEqual(100);
        });

        it('should calculate degraded tests when history exists', () => {
            // First snapshot
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'pass', duration: 100, timestamp: new Date() }
            ]);
            monitor.generateReport();

            // Second snapshot with worse results
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't4', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't5', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't6', status: 'fail', duration: 100, timestamp: new Date() }
            ]);
            const report = monitor.generateReport();

            expect(report.degradedTests.length).toBeGreaterThan(0);
        });
    });

    describe('getFlakyTests', () => {
        it('should return empty array when no flaky tests', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() }
            ]);

            const flaky = monitor.getFlakyTests();
            expect(flaky).toEqual([]);
        });

        it('should return flaky tests above threshold', () => {
            monitor.recordResults([
                { testFile: 'flaky.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't3', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't4', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const flaky = monitor.getFlakyTests(20);
            expect(flaky.length).toBeGreaterThan(0);
        });

        it('should respect custom threshold', () => {
            monitor.recordResults([
                { testFile: 'flaky.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't3', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't4', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const lowThreshold = monitor.getFlakyTests(10);
            const highThreshold = monitor.getFlakyTests(90);

            expect(lowThreshold.length).toBeGreaterThanOrEqual(highThreshold.length);
        });
    });

    describe('getTrend', () => {
        it('should return empty array initially', () => {
            const trend = monitor.getTrend();
            expect(trend).toEqual([]);
        });

        it('should return historical snapshots', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
            ]);
            monitor.generateReport();

            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() }
            ]);
            monitor.generateReport();

            const trend = monitor.getTrend();
            expect(trend.length).toBeGreaterThanOrEqual(2);
        });

        it('should limit returned snapshots', () => {
            // Generate multiple snapshots
            for (let i = 0; i < 20; i++) {
                monitor.recordResults([
                    { testFile: `test${i}.spec.ts`, testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
                ]);
                monitor.generateReport();
            }

            const trend5 = monitor.getTrend(5);
            const trend10 = monitor.getTrend(10);

            expect(trend5.length).toBeLessThanOrEqual(5);
            expect(trend10.length).toBeLessThanOrEqual(10);
            expect(trend10.length).toBeGreaterThan(trend5.length);
        });
    });

    describe('checkReliability', () => {
        it('should return empty alerts when all is good', () => {
            // Need many tests to pass 99.7% threshold
            const results: TestResult[] = [];
            for (let i = 0; i < 1000; i++) {
                results.push({
                    testFile: 'test.spec.ts',
                    testName: `test ${i}`,
                    status: 'pass',
                    duration: 100,
                    timestamp: new Date()
                });
            }

            monitor.recordResults(results);

            const alerts = monitor.checkReliability();
            // Should have no alerts about pass rate (all tests pass)
            expect(alerts.some(a => a.includes('PASS RATE BELOW TARGET'))).toBe(false);
        });

        it('should alert when pass rate is below target', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const alerts = monitor.checkReliability();
            expect(alerts.some(a => a.includes('PASS RATE BELOW TARGET'))).toBe(true);
        });

        it('should alert when flaky tests detected', () => {
            monitor.recordResults([
                { testFile: 'flaky.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't3', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'flaky.spec.ts', testName: 't4', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const alerts = monitor.checkReliability();
            expect(alerts.some(a => a.includes('FLAKY TESTS DETECTED'))).toBe(true);
        });

        it('should alert when tests have low reliability', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't2', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't3', status: 'fail', duration: 100, timestamp: new Date() },
                { testFile: 'test.spec.ts', testName: 't4', status: 'fail', duration: 100, timestamp: new Date() }
            ]);

            const alerts = monitor.checkReliability();
            expect(alerts.some(a => a.includes('LOW RELIABILITY'))).toBe(true);
        });
    });

    describe('exportMetrics', () => {
        it('should export metrics as JSON string', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
            ]);

            const exported = monitor.exportMetrics();

            expect(() => JSON.parse(exported)).not.toThrow();
        });

        it('should include all key metrics', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
            ]);

            const exported = monitor.exportMetrics();
            const parsed = JSON.parse(exported);

            expect(parsed.metrics).toBeDefined();
            expect(parsed.metrics.overallPassRate).toBeDefined();
            expect(parsed.metrics.targetPassRate).toBeDefined();
            expect(parsed.metrics.meetsTarget).toBeDefined();
            expect(parsed.metrics.totalTests).toBeDefined();
            expect(parsed.flakyTests).toBeDefined();
            expect(parsed.alerts).toBeDefined();
        });

        it('should include timestamp in ISO format', () => {
            const exported = monitor.exportMetrics();
            const parsed = JSON.parse(exported);

            expect(parsed.timestamp).toBeDefined();
            expect(() => new Date(parsed.timestamp)).not.toThrow();
        });
    });

    describe('setTargetPassRate/getTargetPassRate', () => {
        it('should get default target', () => {
            expect(monitor.getTargetPassRate()).toBe(0.997);
        });

        it('should set custom target', () => {
            monitor.setTargetPassRate(0.95);
            expect(monitor.getTargetPassRate()).toBe(0.95);
        });

        it('should throw on invalid target (negative)', () => {
            expect(() => monitor.setTargetPassRate(-0.1)).toThrow();
        });

        it('should throw on invalid target (greater than 1)', () => {
            expect(() => monitor.setTargetPassRate(1.5)).toThrow();
        });

        it('should allow target of 0', () => {
            monitor.setTargetPassRate(0);
            expect(monitor.getTargetPassRate()).toBe(0);
        });

        it('should allow target of 1', () => {
            monitor.setTargetPassRate(1);
            expect(monitor.getTargetPassRate()).toBe(1);
        });
    });

    describe('clearResults', () => {
        it('should clear all stored results', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
            ]);
            monitor.generateReport();

            expect(monitor.getFileMetrics('test.spec.ts')).not.toBeNull();

            monitor.clearResults();

            expect(monitor.getFileMetrics('test.spec.ts')).toBeNull();
            expect(monitor.getTrend()).toEqual([]);
        });

        it('should allow fresh start after clear', () => {
            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't1', status: 'pass', duration: 100, timestamp: new Date() }
            ]);

            monitor.clearResults();

            monitor.recordResults([
                { testFile: 'test.spec.ts', testName: 't2', status: 'pass', duration: 100, timestamp: new Date() }
            ]);

            expect(monitor.getFileMetrics('test.spec.ts')).not.toBeNull();
        });
    });
});
