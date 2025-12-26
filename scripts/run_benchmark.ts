
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
// Load .env.local first, then .env
dotenv.config({ path: ['.env.local', '.env'] });

import { BenchmarkCase, BenchmarkReport, BenchmarkResult } from '../benchmarks/types';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { runIndependentAgentLoop } from '../agent';
import { ServiceContainer, defaultServices } from '../services/container';
import { AppConfig, RunGroup, AgentState } from '../types';
import { SimulationSandbox } from '../sandbox';

// Mock Services for Benchmark
// Mock Services Factory
const createMockServices = (): ServiceContainer => {
    return {
        github: {} as any,
        sandbox: {
            prepareSandbox: async () => new SimulationSandbox(),
            // Mock other methods if called
            initSandbox: async () => { },
            teardown: async () => { },
        } as any,
        llm: {} as any,
        analysis: {} as any
    };
};

async function runBenchmark(limit: number = 20, caseIdFilter?: string) {
    const casesPath = path.resolve(__dirname, '../benchmarks/cases.json');
    const allCases: BenchmarkCase[] = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));

    // Filter cases
    let cases = allCases;
    if (caseIdFilter) {
        cases = allCases.filter(c => c.id === caseIdFilter);
    } else {
        cases = allCases.slice(0, limit);
    }

    const report: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        totalCases: cases.length,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        results: []
    };

    console.log(`Starting benchmark with ${cases.length} cases (Limit: ${limit})...`);

    for (const testCase of cases) {
        console.log(`Running case: ${testCase.id}`);
        const startTime = Date.now();
        let success = false;
        let error: string | undefined;
        let steps = 0;

        try {
            // Setup Mock Config
            const config: AppConfig = {
                githubToken: process.env.GITHUB_TOKEN || "MOCK_TOKEN",
                repoUrl: testCase.repoUrl,
                devEnv: 'simulation',
                checkEnv: 'simulation',
                selectedRuns: [],
                llmProvider: 'zai',
                customApiKey: process.env.ZAI_API_KEY,
                llmModel: 'GLM-4.7',
                llmTimeout: 600000 // 10 minutes
            };

            const group: RunGroup = {
                id: testCase.id,
                name: "Benchmark Run",
                runIds: [1],
                mainRun: {
                    id: 1,
                    name: "benchmark-workflow",
                    path: ".github/workflows/ci.yml",
                    status: "queued",
                    conclusion: "failure",
                    html_url: "http://mock",
                    head_sha: "HEAD",
                }
            };

            // IF this is a mock case, we might skip the actual agent loop and just simulate logic
            if (testCase.id === 'mock-failure-01') {
                // Simulate agent thinking for 100ms
                await new Promise(resolve => setTimeout(resolve, 100));
                success = true; // Hardcoded success for the harness test
                steps = 5;
            } else {
                // REAL RUN LOGIC
                // Note: This requires active credentials in .env
                try {
                    const services = typeof createMockServices === 'function' && testCase.id.includes('mock') ? createMockServices() : defaultServices;

                    const finalState = await runIndependentAgentLoop(
                        config,
                        group,
                        testCase.initialContext || "",
                        services,
                        () => { },
                        (level, content, agentId, agentName) => {
                            // Minimal logging to stdout
                            if (level === 'ERROR' || level === 'SUCCESS') {
                                console.log(`[${testCase.id}] [${level}] ${content}`);
                            }
                        }
                    );

                    // Simple check: Did it report success in its state?
                    success = finalState.status === 'success';

                } catch (e: any) {
                    error = `Agent crashed: ${e.message}`;
                    console.error(error);
                }
            }

        } catch (e: any) {
            error = e.message;
            console.error(`Case ${testCase.id} failed:`, e);
        }

        const duration = (Date.now() - startTime) / 1000;

        const result: BenchmarkResult = {
            caseId: testCase.id,
            success,
            durationSeconds: duration,
            stepsTaken: steps,
            error
        };

        report.results.push(result);
        if (success) report.successCount++;
        else report.failureCount++;
    }

    report.successRate = report.totalCases > 0 ? report.successCount / report.totalCases : 0;

    console.log(`Benchmark Complete. Success Rate: ${(report.successRate * 100).toFixed(1)}%`);

    // Write report
    const reportPath = path.resolve(__dirname, '../benchmarks/report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    return report;
}

// Execute if run directly
// Execute if run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('run_benchmark.ts');

if (isMainModule) {
    const args = process.argv.slice(2);
    // accepted args: --limit <number>, --case <id>
    let limit = 1; // Default to 1 for safety
    let caseIdFilter: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
            limit = parseInt(args[i + 1], 10);
            i++;
        }
        if (args[i] === '--case' && args[i + 1]) {
            caseIdFilter = args[i + 1];
            i++;
        }
    }

    // Pass filters to runBenchmark (need to update signature or logic inside)
    // For now, we'll just handle it here or modify runBenchmark to take args
    runBenchmark(limit, caseIdFilter).catch(console.error);
}

export { runBenchmark };
