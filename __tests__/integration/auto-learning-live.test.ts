import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runGraphAgent } from '../../agent/graph/coordinator.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';
import { AppConfig, RunGroup, AgentPhase } from '../../types.js';
import { ServiceContainer, defaultServices } from '../../services/container.js';
import { DataIngestionService } from '../../services/DataIngestionService.js';

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
            ingestion: new DataIngestionService(testDb)
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
                head_sha: 'test-sha',
                html_url: '',
                status: 'completed',
                conclusion: 'failure'
            },
            runIds: [1],
            jobs: []
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
});
