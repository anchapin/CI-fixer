import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runGraphAgent } from '../../agent/graph/coordinator.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';
import { AppConfig, RunGroup } from '../../types.js';
import { ServiceContainer, defaultServices } from '../../services/container.js';
import { DataIngestionService } from '../../services/DataIngestionService.js';
import { LearningLoopService } from '../../services/LearningLoopService.js';
import { LearningMetricService } from '../../services/LearningMetricService.js';

describe('Auto-Learning Live Ingestion Integration', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let services: ServiceContainer;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        
        // Setup services with the test DB
        services = {
            ...defaultServices,
            ingestion: new DataIngestionService(testDb),
            learning: new LearningLoopService(testDb),
            learningMetrics: new LearningMetricService(testDb),
            metrics: { recordFixAttempt: vi.fn().mockResolvedValue(undefined) }
        };
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    it('should ingest logs and artifacts automatically when runGraphAgent completes', async () => {
        const config: AppConfig = {
            repoUrl: 'https://github.com/test/repo',
            githubToken: 'fake-token',
            devEnv: 'simulation'
        };

        const group: RunGroup = {
            id: 'test-group-id',
            name: 'test-group-name',
            mainRun: {
                id: 1,
                name: 'test',
                path: '.github/workflows/test.yml',
                head_sha: 'test-sha',
                html_url: '',
                status: 'completed',
                conclusion: 'failure'
            },
            runIds: [1]
        };

        const updateStateCallback = vi.fn();
        const logCallback = vi.fn();

        // Mock GitHub logs fetch
        vi.spyOn(services.github, 'getWorkflowLogs').mockResolvedValue({
            logText: 'Sample log',
            jobName: 'test-job',
            headSha: 'test-sha'
        });

        // Mock Diagnosis
        vi.spyOn(services.analysis, 'diagnoseError').mockResolvedValue({
            summary: 'test error',
            filePath: 'src/app.ts',
            fixAction: 'edit',
            reproductionCommand: 'npm test',
            confidence: 0.9
        });

        // Mock File Finding
        vi.spyOn(services.github, 'findClosestFile').mockResolvedValue({
            path: 'src/app.ts',
            file: { name: 'app.ts', content: 'original code', language: 'typescript' }
        });

        // Mock Detailed Plan
        vi.spyOn(services.analysis, 'generateDetailedPlan').mockResolvedValue({
            goal: 'fix it',
            tasks: [],
            approved: true
        });

        // Mock Fix Generation
        vi.spyOn(services.analysis, 'generateFix').mockResolvedValue('updated content');

        // Mock Lint
        vi.spyOn(services.sandbox, 'toolLintCheck').mockResolvedValue({ valid: true });

        // Force transition to finish in verification
        vi.spyOn(services.analysis, 'runSandboxTest').mockResolvedValue({ passed: true, logs: 'all tests passed' });
        vi.spyOn(services.analysis, 'judgeFix').mockResolvedValue({ passed: true, score: 9, reasoning: 'Looks good' });
        
        await runGraphAgent(
            config,
            group,
            undefined, // sandbox
            undefined, // profile
            'initial context',
            services,
            updateStateCallback,
            logCallback
        );

        // Check if logs were ingested
        const logIngested = await testDb.ingestedData.findMany({
            where: { source: `live-run-${group.id}` }
        });
        expect(logIngested.length).toBe(1);
        expect(logIngested[0].content).toContain('[GraphAgent] Finished');

        // Check if artifacts were ingested
        const artifactIngested = await testDb.ingestedData.findMany({
            where: { source: `live-artifact-${group.id}-src/app.ts` }
        });

        expect(artifactIngested.length).toBe(1);
        expect(artifactIngested[0].content).toBe('updated content');
    });

    it('should recommend a previously successful strategy for similar errors', async () => {
        const category = 'LEARNED_CAT';
        const complexity = 5;
        const tools = ['ls', 'edit'];
        const runId = 'run-1';

        // Create dummy AgentRun first (foreign key requirement)
        await testDb.agentRun.create({
            data: {
                id: runId,
                groupId: 'G1',
                status: 'success',
                state: '{}'
            }
        });

        // 1. Record a successful run outcome directly
        await services.learning.processRunOutcome(runId, category, complexity, tools, {
            success: true,
            llmCost: 0.01,
            totalLatency: 1000,
            llmTokensInput: 100,
            llmTokensOutput: 50,
            toolCallCount: 2
        });

        // 2. Ask for a recommendation for the same category
        const recommendation = await services.learning.getStrategyRecommendation(category, complexity);

        expect(recommendation.preferredTools).toEqual(tools);
        expect(recommendation.historicalStats?.successRate).toBe(1.0);
    });
});
