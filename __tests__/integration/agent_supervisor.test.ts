
import { describe, it, expect, vi } from 'vitest';
import { runIndependentAgentLoop } from '../../agent.js';
import { SimulationSandbox } from '../../sandbox.js';
import { AppConfig, RunGroup } from '../../types.js';
import { setupInMemoryDb, getTestDb } from '../helpers/vitest-setup.js';

// Setup test database
setupInMemoryDb();

// Mock validation and classification modules
vi.mock('../../validation.js', () => ({
    analyzeRepository: vi.fn().mockResolvedValue({
        languages: ['typescript'],
        packageManager: 'npm',
        buildSystem: 'vite',
        testFramework: 'vitest',
        availableScripts: { test: 'vitest' },
        directoryStructure: { hasBackend: false, hasFrontend: true, testDirectories: [], sourceDirectories: [] },
        configFiles: [],
        repositorySize: 50
    }),
    formatProfileSummary: vi.fn().mockReturnValue('Mock Profile'),
    validateFileExists: vi.fn().mockResolvedValue(true),
    validateCommand: vi.fn().mockReturnValue({ valid: true })
}));

vi.mock('../../errorClassification.js', () => ({
    classifyError: vi.fn().mockReturnValue({
        category: 'disk_space',
        confidence: 0.95,
        rootCauseLog: 'No space left',
        cascadingErrors: [],
        affectedFiles: [],
        errorMessage: 'No space left on device'
    }),
    classifyErrorWithHistory: vi.fn().mockReturnValue({
        category: 'disk_space',
        confidence: 0.95,
        rootCauseLog: 'No space left',
        cascadingErrors: [],
        affectedFiles: [],
        errorMessage: 'No space left on device'
    }),
    formatErrorSummary: vi.fn().mockReturnValue('Error Summary'),
    getErrorPriority: vi.fn().mockReturnValue(10),
    isCascadingError: vi.fn().mockReturnValue(false)
}));

// Mock services to avoid external API calls
vi.mock('../../services.js', async (importOriginal: any) => {
    const actual = await importOriginal();
    return {
        ...actual,
        prepareSandbox: vi.fn().mockImplementation(async () => {
            const sandbox = new SimulationSandbox();
            await sandbox.init();
            return sandbox;
        }),
        getWorkflowLogs: vi.fn().mockResolvedValue({ logText: "Error: No space left on device\nModuleNotFoundError", headSha: "sha123", jobName: "test-job" }),
        diagnoseError: vi.fn().mockResolvedValue({
            summary: "No space left on device",
            fixAction: "edit",
            filePath: ".github/workflows/deploy.yml",
            reproductionCommand: "npm test"
        }),
        generateDetailedPlan: vi.fn().mockResolvedValue({ goal: "Fix space issue", tasks: [], approved: true }),
        findClosestFile: vi.fn().mockResolvedValue({
            file: { content: "steps:\n  - run: npm install", language: "yaml", name: "deploy.yml" },
            path: ".github/workflows/deploy.yml"
        }),
        toolCodeSearch: vi.fn().mockResolvedValue([".github/workflows/deploy.yml"]),
        toolWebSearch: vi.fn().mockResolvedValue("Use docker prune"),
        generateFix: vi.fn().mockResolvedValue("steps:\n  - run: docker system prune -af\n  - run: npm install"),
        toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
        judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 9, reasoning: "Good fix" }),
        runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "Build Success" }),
        generateRepoSummary: vi.fn().mockResolvedValue("Repo Context"), // Mock the generator
    };
});

vi.mock('../../services/context-compiler.js', () => ({
    getCachedRepoContext: vi.fn().mockResolvedValue("Cached Context"),
    filterLogs: vi.fn().mockReturnValue("Filtered Logs"),
    summarizeLogs: vi.fn().mockResolvedValue("Log Summary")
}));

describe('Agent Supervisor-Worker Integration', () => {
    it('should coordinate Supervisor and Worker to complete a fix', async () => {
        // Seed the database with the run
        const db = getTestDb();
        await db.agentRun.create({
            data: {
                id: 'g1',
                groupId: 'g1', // supervisor uses group.id for everything
                status: 'pending',
                state: '{}'
            }
        });

        const config: AppConfig = {
            githubToken: 'test-token',
            repoUrl: 'owner/repo',
            checkEnv: 'simulation',
            devEnv: 'simulation',
            selectedRuns: []
        };

        const group: RunGroup = {
            id: 'g1',
            name: 'test-run',
            runIds: [123],
            mainRun: { head_sha: 'sha123' } as any
        };

        const updateState = vi.fn();
        const logCallback = vi.fn();

        const state = await runIndependentAgentLoop(
            config,
            group,
            "Initial Context",
            updateState,
            logCallback
        );

        expect(state.status).toBe('success');
        expect(state.phase).toBe('SUCCESS');
        expect(updateState).toHaveBeenCalled();
        // Check logs to verify Supervisor -> Worker flow
        const calls = logCallback.mock.calls.map(c => c[1]);
        expect(calls.some(c => c.includes('Initializing Supervisor Environment'))).toBe(true);
        expect(calls.some(c => c.includes('Spawning Worker Agent'))).toBe(true);
        expect(calls.some(c => c.includes('[Worker] Starting analysis'))).toBe(true);
        expect(calls.some(c => c.includes('Worker succeeded'))).toBe(true);
    });
});
