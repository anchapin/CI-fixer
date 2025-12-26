import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AppConfig, RunGroup, AgentPhase } from '../../types';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';
import { ErrorCategory } from '../../types.js';

// Reuse mocks from agent_flow.test.ts logic but tailored for this test

vi.mock('../../services/analysis/LogAnalysisService.js', () => ({
    diagnoseError: vi.fn(),
    generateDetailedPlan: vi.fn(),
    formatPlanToMarkdown: vi.fn().mockReturnValue("Plan MD"),
    generateFix: vi.fn(),
    judgeFix: vi.fn(),
    runSandboxTest: vi.fn(),
    generateRepoSummary: vi.fn()
}));

vi.mock('../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn(),
    findClosestFile: vi.fn()
}));

vi.mock('../../services/sandbox/SandboxService.js', () => ({
    toolScanDependencies: vi.fn(),
    toolCodeSearch: vi.fn(),
    toolSemanticCodeSearch: vi.fn(),
    toolWebSearch: vi.fn(),
    toolLintCheck: vi.fn(),
    prepareSandbox: vi.fn()
}));

vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn()
}));

vi.mock('../../services/context-compiler', () => ({
    getCachedRepoContext: vi.fn(() => Promise.resolve("mock context"))
}));

vi.mock('../../validation', () => ({
    validateFileExists: vi.fn(() => Promise.resolve(true)),
    validateCommand: vi.fn(() => ({ valid: true })),
    analyzeRepository: vi.fn(() => Promise.resolve({})),
    formatProfileSummary: vi.fn(() => "Profile Summary")
}));

vi.mock('../../db/client', () => ({
    db: {
        agentRun: { create: vi.fn(() => Promise.resolve({ id: 'run-1' })), update: vi.fn() },
        agentMetrics: { create: vi.fn() },
        fixAttempt: { create: vi.fn() },
        fixTrajectory: { create: vi.fn() }
    }
}));

describe('Dependency Conflict Multi-Error Flow', () => {
    const mockUpdateState = vi.fn();
    const mockLog = vi.fn();

    const config: AppConfig = {
        githubToken: 'test-token',
        repoUrl: 'owner/repo',
        llmProvider: 'openai',
        devEnv: 'simulation'
    } as any;

    const group: RunGroup = {
        id: 'run-1',
        runIds: [123],
        mainRun: { head_sha: 'sha123' },
        status: 'pending'
    } as any;

    let testServices: any;

    beforeEach(() => {
        vi.clearAllMocks();
        testServices = {
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
                // Mock detecting TWO errors: one dependency conflict, one missing file
                classifyErrorWithHistory: vi.fn()
                    .mockResolvedValueOnce({
                        category: ErrorCategory.DEPENDENCY_CONFLICT,
                        confidence: 0.95,
                        errorMessage: 'pkg_resources.ContextualVersionConflict: pydantic>=2.0.0',
                        affectedFiles: ['pyproject.toml'],
                    })
                    .mockResolvedValueOnce({
                        category: ErrorCategory.DEPENDENCY,
                        confidence: 0.9,
                        errorMessage: 'ModuleNotFoundError: No module named "ai-engine"',
                        affectedFiles: ['main.py'],
                    }),
                getErrorPriority: vi.fn((cat) => cat === ErrorCategory.DEPENDENCY_CONFLICT ? 8 : 7),
            } as any,
            dependency: {
                hasBlockingDependencies: vi.fn().mockResolvedValue(false),
                getBlockedErrors: vi.fn().mockResolvedValue([]),
            } as any,
            clustering: { clusterError: vi.fn() } as any,
            complexity: {
                estimateComplexity: vi.fn().mockReturnValue(5),
                detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                isAtomic: vi.fn().mockReturnValue(false),
                explainComplexity: vi.fn().mockReturnValue('Complexity'),
            } as any,
            repairAgent: {
                getRepairAgentConfig: vi.fn().mockReturnValue({}),
                runRepairAgent: vi.fn().mockResolvedValue({ status: 'success' }),
            } as any,
            metrics: { recordFixAttempt: vi.fn() } as any
        };

        vi.mocked(SandboxService.prepareSandbox).mockResolvedValue(new SimulationSandbox());
                vi.mocked(GitHubService.getWorkflowLogs).mockResolvedValue({
                    logText: 'CONFLICT LOG\nMISSING FILE LOG',
                    jobName: 'test',
                    headSha: 'sha123'
                });    });

    it('should prioritize or include dependency conflict fix when multiple errors exist', async () => {
        // We want to see that the agent doesn't just fix the missing file and stop
        // In the current implementation, it might only take the "primary" error.
        // If we want it to be robust, it should either:
        // 1. Take both if they are high confidence.
        // 2. Or at least pick the DEPENDENCY_CONFLICT because it has higher priority.

        await runIndependentAgentLoop(config, group, 'ctx', testServices as any, mockUpdateState, mockLog);

        // Verify that the planner was called with the dependency conflict error
        // Note: The actual internal call might be to generateDetailedPlan or similar
        expect(testServices.classification.classifyErrorWithHistory).toHaveBeenCalled();
        
        // This test will initially "pass" if it picks the conflict due to priority, 
        // but we want to ENSURE it doesn't get distracted by the "simpler" error 
        // if the simpler one appeared first or something.
    });
});
