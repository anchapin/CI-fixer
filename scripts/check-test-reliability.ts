#!/usr/bin/env node
/**
 * Test Reliability Check CLI
 *
 * Command-line utility to check test reliability and generate reports.
 * Integrates with CI/CD pipelines to maintain 99.7% pass rate target.
 *
 * Usage:
 *   npm run check-reliability
 *   node scripts/check-test-reliability.ts
 */

import { testReliabilityMonitor } from '../services/monitoring/index.js';
import { writeFileSync } from 'fs';

interface CliOptions {
    verbose?: boolean;
    export?: string;
    threshold?: number;
}

function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    const options: CliOptions = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--export':
            case '-e':
                options.export = args[++i];
                break;
            case '--threshold':
            case '-t':
                options.threshold = parseFloat(args[++i]);
                break;
        }
    }

    return options;
}

function main() {
    const options = parseArgs();

    console.log('🧪 Test Reliability Check\n');

    // Generate report
    const report = testReliabilityMonitor.generateReport();

    // Print summary
    console.log('📊 Summary');
    console.log(`   Total Tests: ${report.totalTests}`);
    console.log(`   Total Runs: ${report.totalRuns}`);
    console.log(`   Passed: ${report.passed}`);
    console.log(`   Failed: ${report.failed}`);
    console.log(`   Skipped: ${report.skipped}`);
    console.log(`   Pass Rate: ${(report.overallPassRate * 100).toFixed(2)}%`);
    console.log(`   Target: ${(report.targetPassRate * 100).toFixed(2)}%`);
    console.log(`   Status: ${report.meetsTarget ? '✅ MEETS TARGET' : '❌ BELOW TARGET'}`);

    // Check for alerts
    const alerts = testReliabilityMonitor.checkReliability();
    if (alerts.length > 0) {
        console.log('\n⚠️  Alerts');
        alerts.forEach(alert => console.log(`   ${alert}`));
    }

    // Print flaky tests
    if (report.flakyTests.length > 0) {
        console.log('\n🔀 Flaky Tests');
        report.flakyTests.forEach(test => console.log(`   - ${test}`));
    }

    // Print degraded tests
    if (report.degradedTests.length > 0) {
        console.log('\n📉 Degraded Tests');
        report.degradedTests.forEach(test => console.log(`   - ${test}`));
    }

    // Print improvements
    if (report.improvements.length > 0) {
        console.log('\n📈 Improvements');
        report.improvements.forEach(test => console.log(`   + ${test}`));
    }

    // Verbose output: print all test files
    if (options.verbose && report.testFiles.length > 0) {
        console.log('\n📋 Test File Details');
        report.testFiles.forEach(file => {
            console.log(`   ${file.testFile}`);
            console.log(`     Pass Rate: ${(file.passRate * 100).toFixed(2)}%`);
            console.log(`     Flaky Score: ${file.flakyScore.toFixed(0)}%`);
            console.log(`     Avg Duration: ${file.avgDuration.toFixed(0)}ms`);
            console.log(`     Runs: ${file.totalRuns}`);
        });
    }

    // Export metrics to JSON if requested
    if (options.export) {
        writeFileSync(options.export, testReliabilityMonitor.exportMetrics());
        console.log(`\n📁 Exported metrics to: ${options.export}`);
    }

    // Exit with appropriate code
    if (!report.meetsTarget) {
        console.log('\n❌ Reliability check FAILED: Pass rate below target');
        process.exit(1);
    }

    if (alerts.length > 0) {
        console.log('\n⚠️  Reliability check completed with warnings');
        process.exit(2); // Warning exit code
    }

    console.log('\n✅ Reliability check PASSED');
    process.exit(0);
}

main();
