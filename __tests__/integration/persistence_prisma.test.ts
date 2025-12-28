
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { runIndependentAgentLoop } from '../../agent.js';
import { AppConfig, RunGroup } from '../../types.js';
import { PrismaClient } from '@prisma/client';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { ServiceContainer } from '../../services/container.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as AnalysisService from '../../services/analysis/LogAnalysisService.js';

import { LoopDetector } from '../../services/LoopDetector.js';

// Create a shared test database instance
let testDb: PrismaClient;
let testDbManager: TestDatabaseManager;

// Mock database client to use test database
vi.mock('../../services/db.js', () => {
    const mockPrisma = {
        fileModification: { create: vi.fn(), findMany: vi.fn() },
        errorFact: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
        agentRun: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() }
    };
    return new Proxy(mockPrisma, {
        get(target, prop) {
            if (prop === 'then') return undefined;
            const db = (globalThis as any).__TEST_DB__;
            return db ? db[prop] : (mockPrisma as any)[prop];
        }
    });
});

// Mock Services
vi.mock('../../services/analysis/LogAnalysisService.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        diagnoseError: vi.fn().mockResolvedValue({
            summary: "Test Failure DB Check",
            fixAction: "edit",
            filePath: "src/test.ts"
        }),
        generateDetailedPlan: vi.fn().mockResolvedValue({ goal: "Fix", tasks: [], approved: true }),
        generateFix: vi.fn().mockResolvedValue("fixed code"),
        judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10 }),
        formatPlanToMarkdown: vi.fn().mockReturnValue("Plan MD")
    };
});

vi.mock('../../services/github/GitHubService.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        getWorkflowLogs: vi.fn().mockResolvedValue({ logText: "Error: Test Failure", headSha: "sha", jobName: "test" }),
        findClosestFile: vi.fn().mockResolvedValue({
            file: { content: "code", language: "ts", name: "test.ts" },
            path: "src/test.ts"
        })
    };
});

vi.mock('../../services/sandbox/SandboxService.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        toolCodeSearch: vi.fn(),
        toolWebSearch: vi.fn().mockResolvedValue(""),
        toolLintCheck: vi.fn().mockResolvedValue({ valid: true, errors: [] }).mockResolvedValue([]),
        toolScanDependencies: vi.fn().mockResolvedValue("Deps OK"),
        toolSemanticCodeSearch: vi.fn(),
        extractFileOutline: vi.fn().mockReturnValue("Outline"),
        prepareSandbox: vi.fn().mockResolvedValue({
            getId: () => 'mock-sandbox',
            init: vi.fn(),
            teardown: vi.fn(),
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
            writeFile: vi.fn(),
            readFile: vi.fn().mockResolvedValue(''),
            getWorkDir: () => '/'
        })
    };
});

vi.mock('../../services/analysis/ValidationService.js', () => ({
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "PASS" })
}));

describe('Prisma Persistence Integration', () => {
    const testGroupId = 'test-group-persistence-' + Date.now();

    beforeAll(async () => {
        // Setup test database
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        (globalThis as any).__TEST_DB__ = testDb;
    });

    afterAll(async () => {
        // Cleanup test database
        (globalThis as any).__TEST_DB__ = undefined;
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    it('should store ErrorFact and FileModification in SQLite', async () => {
        // 1. Create AgentRun entry
        await testDb.agentRun.create({
            data: {
                id: testGroupId,
                groupId: testGroupId,
                status: 'working',
                state: '{}'
            }
        });

        // 2. Invoke Worker
        const config: AppConfig = {
            githubToken: 't',
            repoUrl: 'r',
            checkEnv: 'simulation',
            devEnv: 'simulation',
            selectedRuns: [] // Added to satisfy AppConfig interface
        };

        const group: RunGroup = {
            id: testGroupId,
            name: 'Persistence Test',
            runIds: [1],
            mainRun: { head_sha: 'abc' } as any
        };

        const updateState = vi.fn();
        const logCallback = vi.fn((level, msg) => console.log(`[${level}] ${msg}`));

        // Create ServiceContainer with mocked services
        const services: ServiceContainer = {
            github: await import('../../services/github/GitHubService.js'),
            analysis: await import('../../services/analysis/LogAnalysisService.js'),
            llm: {} as any,
            sandbox: {
                ...await import('../../services/sandbox/SandboxService.js'),
                toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
                prepareSandbox: vi.fn().mockResolvedValue({
                    getId: () => 'mock-sandbox',
                    init: vi.fn(),
                    teardown: vi.fn(),
                    runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
                    writeFile: vi.fn(),
                    readFile: vi.fn().mockResolvedValue('original code'),
                    getWorkDir: () => '/'
                })
            },
            discovery: { 
                findUniqueFile: vi.fn().mockResolvedValue({ 
                    found: true, 
                    path: 'src/test.ts', 
                    relativePath: 'src/test.ts', 
                    matches: ['src/test.ts'] 
                }) 
            } as any,
            verification: { verifyFile: vi.fn() } as any,
            fallback: { generateFallback: vi.fn() } as any,
            environment: { refreshDependencies: vi.fn(), purgeEnvironment: vi.fn() } as any,
            loopDetector: new LoopDetector(),
            context: await import('../../services/context-manager.js'),
            classification: await import('../../errorClassification.js'),
            dependency: await import('../../services/dependency-tracker.js'),
            clustering: await import('../../services/error-clustering.js'),
            complexity: await import('../../services/complexity-estimator.js'),
            repairAgent: await import('../../services/repair-agent/orchestrator.js'),
            metrics: await import('../../telemetry/metrics.js'),
            ingestion: { ingestRawData: vi.fn() } as any,
            learning: { 
                recordLearning: vi.fn(), 
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 1.0 }),
                getStrategyRecommendation: vi.fn().mockResolvedValue({ 
                    preferredTools: [], 
                    historicalStats: { successRate: 0.8 } 
                }) 
            } as any,
            learningMetrics: { recordMetric: vi.fn(), getAverageMetricValue: vi.fn() } as any,
            reproductionInference: { inferCommand: vi.fn() } as any
        };

        await runIndependentAgentLoop(config, group, 'initial', services, updateState, logCallback);

        // 3. Verify ErrorFact
        const facts = await testDb.errorFact.findMany({
            where: { runId: testGroupId }
        });
        expect(facts.length).toBeGreaterThan(0);
        expect(facts[0].summary).toBe("Test Failure DB Check");
        console.log("DB Facts:", facts);

        // 4. Verify FileModification
        const mods = await testDb.fileModification.findMany({
            where: { runId: testGroupId }
        });
        const fs = await import('fs');
        fs.appendFileSync('debug_assertion.txt', `[DEBUG] Mods count: ${mods.length}. Content: ${JSON.stringify(mods)}\n`);
        expect(mods.length).toBeGreaterThan(0);
        // The path stored is absolute in this environment
        expect(mods[0].path).toContain("src/test.ts");
        console.log("DB Mods:", mods);
    });
});
