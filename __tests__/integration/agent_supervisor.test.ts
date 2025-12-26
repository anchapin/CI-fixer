
import { describe, it, expect, vi } from 'vitest';
import { runIndependentAgentLoop } from '../../agent.js';
import { SimulationSandbox } from '../../sandbox.js';
import { AppConfig, RunGroup } from '../../types.js';
import { setupInMemoryDb, getTestDb } from '../helpers/vitest-setup.js';

// Mock database client to use test database
vi.mock('../../db/client.js', async () => {
    const { getTestDb } = await import('../helpers/vitest-setup.js');
    return {
        db: new Proxy({}, {
            get(target, prop) {
                const testDb = getTestDb();
                const value = (testDb as any)[prop];
                if (typeof value === 'function') {
                    return value.bind(testDb);
                }
                return value;
            }
        })
    };
});

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

// Mock direct imports used by Nodes
vi.mock('../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn().mockResolvedValue({
        summary: "No space left on device",
        fixAction: "edit",
        filePath: ".github/workflows/deploy.yml",
        reproductionCommand: "npm test"
    }),
    generateDetailedPlan: vi.fn().mockResolvedValue({ goal: "Fix space issue", tasks: [], approved: true }),
    generateFix: vi.fn().mockResolvedValue("steps:\n  - run: docker system prune -af\n  - run: npm install"),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 9, reasoning: "Good fix" }),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "Build Success" }),
    generateRepoSummary: vi.fn().mockResolvedValue("Repo Context"),
    formatPlanToMarkdown: vi.fn().mockReturnValue("Plan MD")
}));

vi.mock('../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({ logText: "Error: No space left on device\nModuleNotFoundError", headSha: "sha123", jobName: "test-job" }),
    findClosestFile: vi.fn().mockResolvedValue({
        file: { content: "steps:\n  - run: npm install", language: "yaml", name: "deploy.yml" },
        path: ".github/workflows/deploy.yml"
    })
}));

vi.mock('../../services/sandbox/SandboxService.js', () => ({
    toolCodeSearch: vi.fn().mockResolvedValue([".github/workflows/deploy.yml"]),
    toolWebSearch: vi.fn().mockResolvedValue("Use docker prune"),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
    toolScanDependencies: vi.fn().mockResolvedValue("Deps OK"),
    extractFileOutline: vi.fn().mockReturnValue("Outline")
}));

// We need to mock prepareSandbox explicitly since Supervisor calls it
vi.mock('../../services/sandbox/SandboxService.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        prepareSandbox: vi.fn().mockImplementation(async () => {
            const sandbox = new SimulationSandbox();
            await sandbox.init();
            return sandbox;
        }),
        toolCodeSearch: vi.fn().mockResolvedValue([".github/workflows/deploy.yml"]),
        toolWebSearch: vi.fn().mockResolvedValue("Use docker prune"),
        toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
        toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
        toolScanDependencies: vi.fn().mockResolvedValue("Deps OK"),
    };
});

// Mock services.js if needed
vi.mock('../../services.js', async (importOriginal: any) => {
    return {
        ...await importOriginal(),
    };
});

vi.mock('../../services/context-compiler.js', () => ({
    getCachedRepoContext: vi.fn().mockResolvedValue("Cached Context"),
    filterLogs: vi.fn().mockReturnValue("Filtered Logs"),
    summarizeLogs: vi.fn().mockResolvedValue("Log Summary")
}));

vi.mock('../../services/llm/LLMService', () => ({
    LLMService: vi.fn().mockImplementation(() => ({
        // Mock methods of LLMService if needed
        // For example:
        // callLLM: vi.fn().mockResolvedValue("LLM response"),
    }))
}));

describe('Agent Supervisor-Worker Integration', () => {
    // Increase timeout for this suite
    vi.setConfig({ testTimeout: 60000 });

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

        // Create proper ServiceContainer structure
        const GitHubService = await import('../../services/github/GitHubService.js');
        const LogAnalysisService = await import('../../services/analysis/LogAnalysisService.js');
        const SandboxService = await import('../../services/sandbox/SandboxService.js');
        const LLMService = await import('../../services/llm/LLMService.js');

        const testServices = {
            github: GitHubService,
            analysis: LogAnalysisService,
            sandbox: SandboxService,
            llm: LLMService,
            context: {
                smartThinLog: vi.fn().mockImplementation(async (log) => log),
                thinLog: vi.fn().mockImplementation((log) => log),
                formatHistorySummary: vi.fn().mockReturnValue('History'),
                formatPlanToMarkdown: vi.fn().mockReturnValue('Plan'),
                markNodeSolved: vi.fn().mockReturnValue({ solvedNodes: [] }),
            } as any,
            classification: {
                classifyErrorWithHistory: vi.fn().mockResolvedValue({
                    category: 'logic',
                    confidence: 0.9,
                    errorMessage: 'Error',
                    affectedFiles: [],
                }),
                getErrorPriority: vi.fn().mockReturnValue(5),
            } as any,
            dependency: {
                hasBlockingDependencies: vi.fn().mockResolvedValue(false),
                getBlockedErrors: vi.fn().mockResolvedValue([]),
            } as any,
            clustering: {
                clusterError: vi.fn(),
            } as any,
            complexity: {
                estimateComplexity: vi.fn().mockReturnValue(5),
                detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                isAtomic: vi.fn().mockReturnValue(false),
                explainComplexity: vi.fn().mockReturnValue('Complexity'),
            } as any,
            repairAgent: {
                getRepairAgentConfig: vi.fn().mockReturnValue({}),
                runRepairAgent: vi.fn(),
            } as any,
            metrics: {
                recordFixAttempt: vi.fn(),
            } as any,
            learning: {
                getStrategyRecommendation: vi.fn().mockResolvedValue({
                    preferredTools: ['llm'],
                    historicalStats: { successRate: 0.8 }
                })
            } as any,
            discovery: {
                findUniqueFile: vi.fn().mockResolvedValue({ found: true, path: '.github/workflows/deploy.yml', relativePath: '.github/workflows/deploy.yml', matches: ['.github/workflows/deploy.yml'] }),
                recursiveSearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForRename: vi.fn().mockResolvedValue(null),
                fuzzySearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForDeletion: vi.fn().mockResolvedValue(false)
            } as any,
            verification: {
                verifyContentMatch: vi.fn().mockResolvedValue(true)
            } as any,
            fallback: {
                generatePlaceholder: vi.fn().mockResolvedValue(undefined)
            } as any
        };

        const state = await runIndependentAgentLoop(
            config,
            group,
            "Initial Context",
            testServices as any,
            updateState,
            logCallback
        );

        expect(state.status).toBe('success');
        expect(state.phase).toBe('SUCCESS');
        expect(updateState).toHaveBeenCalled();
        // Check logs to verify Supervisor -> Worker flow
        const calls = logCallback.mock.calls.map(c => c[1]);
        expect(calls.some(c => c.includes('Initializing Supervisor Environment'))).toBe(true);
        expect(calls.some(c => c.includes('Spawning Graph Agent'))).toBe(true);
        expect(calls.some(c => c.includes('[AnalysisNode] Starting verification/analysis'))).toBe(true);
        expect(calls.some(c => c.includes('Task Complete'))).toBe(true);
    });
});
