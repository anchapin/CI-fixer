
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGraphAgent } from '../../agent/graph/coordinator.js';
import { AppConfig, RunGroup, AgentPhase } from '../../types.js';
import { ServiceContainer } from '../../services/container.js';
import { MockSandboxEnv } from '../mocks/MockSandboxEnv.js';

// Mock Services
vi.mock('../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn().mockResolvedValue({
        summary: "Fix syntax error",
        filePath: "src/broken.ts",
        fixAction: "edit",
        suggestedCommand: "npm test"
    }),
    generateDetailedPlan: vi.fn().mockResolvedValue({
        goal: "Fix syntax error",
        tasks: [{ id: "1", description: "Fix typo", status: "pending" }],
        approved: true
    }),
    formatPlanToMarkdown: vi.fn().mockReturnValue("# Plan\n- [ ] Fix typo"),
    generateFix: vi.fn().mockResolvedValue("console.log('fixed');"),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: "Perfect" }),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "All tests passed" }),
    generateRepoSummary: vi.fn().mockResolvedValue("Repo Summary")
}));

vi.mock('../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({ logText: "Error: SyntaxError", jobName: "Build", headSha: "abc" }),
    findClosestFile: vi.fn().mockResolvedValue({ path: "src/broken.ts", file: { content: "console.log('broken')" } }),
    toolCodeSearch: vi.fn().mockResolvedValue([])
}));

vi.mock('../../services/context-manager.js', () => ({
    thinLog: vi.fn().mockReturnValue("Thinned Log"),
    smartThinLog: vi.fn().mockReturnValue("Smart Thinned Log"),
    formatHistorySummary: vi.fn().mockReturnValue("")
}));

vi.mock('../../services/analysis/CodeAnalysisService.js', () => ({
    extractFileOutline: vi.fn().mockReturnValue("File Outline")
}));

vi.mock('../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn().mockResolvedValue("express"),
    toolCodeSearch: vi.fn().mockResolvedValue(["src/broken.ts"]),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true, error: "" }),
    toolWebSearch: vi.fn().mockResolvedValue("Solution found"),
    runDevShellCommand: vi.fn().mockResolvedValue({ output: "Shell Output", exitCode: 0 })
}));

vi.mock('../../db/client.js', () => ({
    db: {
        agentJob: { update: vi.fn() },
        jobHistory: { create: vi.fn() }
    }
}));

vi.mock('../../errorClassification.js', () => ({
    classifyErrorWithHistory: vi.fn().mockResolvedValue({ category: 'SyntaxError', suggestedAction: 'fix typo', confidence: 0.9 }),
    getErrorPriority: vi.fn().mockReturnValue("HIGH")
}));

vi.mock('../../services/dependency-analyzer.js', () => ({
    getImmediateDependencies: vi.fn().mockResolvedValue([])
}));


describe('Graph Agent Architecture', () => {

    const mockConfig: AppConfig = {
        githubToken: 'fake',
        repoUrl: 'owner/repo',
        selectedRuns: [],
        devEnv: 'e2b',
        checkEnv: 'e2b'
    };

    const mockGroup: RunGroup = {
        id: 'test-group',
        name: 'test-run',
        runIds: [123],
        mainRun: {} as any
    };

    const mockServices = {} as ServiceContainer; // Mocks handled by vi.mock
    const mockUpdateState = vi.fn();
    const mockLog = vi.fn();
    let mockSandbox: MockSandboxEnv;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSandbox = new MockSandboxEnv();
    });

    it('should run through the full success path', async () => {
        // Import the mocked modules to get the mocked implementations
        const GitHubService = await import('../../services/github/GitHubService.js');
        const LogAnalysisService = await import('../../services/analysis/LogAnalysisService.js');
        const SandboxService = await import('../../services/sandbox/SandboxService.js');
        const LLMService = await import('../../services/llm/LLMService.js');

        // Create a proper service container with the mocked services
        const services: ServiceContainer = {
            github: GitHubService as any,
            analysis: LogAnalysisService as any,
            sandbox: SandboxService as any,
            llm: LLMService as any,
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
                }),
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 10.0 })
            } as any,
            discovery: {
                findUniqueFile: vi.fn().mockResolvedValue({ found: true, path: 'src/broken.ts', relativePath: 'src/broken.ts', matches: ['src/broken.ts'] }),
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

        const result = await runGraphAgent(
            mockConfig,
            mockGroup,
            mockSandbox as any,
            undefined, // profile
            "Initial Context",
            services,
            mockUpdateState,
            mockLog
        );

        // Verify Transitions
        // Analysis -> Planning -> Execution -> Verification -> Finish

        expect(result.status).toBe('success');
        expect(result.phase).toBe(AgentPhase.SUCCESS);
        expect(result.iteration).toBeGreaterThanOrEqual(0);

        // Check if logs were called
        expect(mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('Initializing Graph Architecture...'), expect.anything(), expect.anything());
        expect(mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('Finished. Status: success'), expect.anything(), expect.anything());
    });

});
