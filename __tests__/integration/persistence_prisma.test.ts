
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWorkerTask } from '../../agent/worker.js';
import { db } from '../../db/client.js';
import { AppConfig, RunGroup } from '../../types.js';

// Mock services to run quickly and strictly output specific diagnosis
vi.mock('../../services.js', async (importOriginal: any) => {
    return {
        getWorkflowLogs: vi.fn().mockResolvedValue({ logText: "Error: Test Failure", headSha: "sha", jobName: "test" }),
        diagnoseError: vi.fn().mockResolvedValue({
            summary: "Test Failure DB Check",
            fixAction: "edit",
            filePath: "src/test.ts"
        }),
        generateDetailedPlan: vi.fn().mockResolvedValue({ goal: "Fix", tasks: [], approved: true }),
        findClosestFile: vi.fn().mockResolvedValue({
            file: { content: "code", language: "ts", name: "test.ts" },
            path: "src/test.ts"
        }),
        toolCodeSearch: vi.fn().mockResolvedValue([]),
        toolWebSearch: vi.fn().mockResolvedValue(""),
        generateFix: vi.fn().mockResolvedValue("fixed code"),
        toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
        judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10 }),
        runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "PASS" }),
        generateRepoSummary: vi.fn().mockResolvedValue("Repo Context"),
        toolScanDependencies: vi.fn().mockResolvedValue("Deps OK"),
    };
});

vi.mock('../../services/context-compiler.js', () => ({
    getCachedRepoContext: vi.fn().mockResolvedValue('CTX'),
}));

describe('Prisma Persistence Integration', () => {

    const testGroupId = 'test-group-persistence-' + Date.now();

    beforeEach(async () => {
        // Cleanup potentially colliding data
        try {
            await db.errorFact.deleteMany({ where: { runId: testGroupId } });
            await db.fileModification.deleteMany({ where: { runId: testGroupId } });
            await db.agentRun.deleteMany({ where: { id: testGroupId } });
        } catch (e) {
            console.warn("DB Cleanup failed", e);
        }
    });

    it('should store ErrorFact and FileModification in SQLite', async () => {
        // 1. Create AgentRun entry (Required for foreign keys)
        await db.agentRun.create({
            data: {
                id: testGroupId,
                groupId: testGroupId,
                status: 'working',
                state: '{}'
            }
        });

        // 2. Invoke Worker
        const config: AppConfig = {
            githubToken: 't', repoUrl: 'r', checkEnv: 'simulation', devEnv: 'simulation', openaiApiKey: 'k'
        };
        const group: RunGroup = {
            id: testGroupId,
            name: 'Persistence Test',
            runIds: [1],
            mainRun: { head_sha: 'abc' } as any
        };

        const updateState = vi.fn();
        const logCallback = vi.fn();

        await runWorkerTask(config, group, undefined, 'initial', updateState, logCallback);

        // 3. Verify ErrorFact
        const facts = await db.errorFact.findMany({
            where: { runId: testGroupId }
        });
        expect(facts.length).toBeGreaterThan(0);
        expect(facts[0].summary).toBe("Test Failure DB Check");
        console.log("DB Facts:", facts);

        // 4. Verify FileModification
        const mods = await db.fileModification.findMany({
            where: { runId: testGroupId }
        });
        expect(mods.length).toBeGreaterThan(0);
        expect(mods[0].path).toBe("src/test.ts");
        console.log("DB Mods:", mods);

    });
});
