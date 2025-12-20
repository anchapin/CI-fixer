import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AppConfig, RunGroup, AgentPhase } from '../../types';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';
import { ErrorCategory } from '../../errorClassification';

// Mock Services
vi.mock('../../services/analysis/CodeAnalysisService.js', () => ({
    extractFileOutline: vi.fn()
}));
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
    getCachedRepoContext: vi.fn((config, sha, gene) => Promise.resolve("mock context"))
}));

vi.mock('../../validation', () => ({
    validateFileExists: vi.fn(() => Promise.resolve(true)),
    validateCommand: vi.fn(() => ({ valid: true })),
    analyzeRepository: vi.fn(() => Promise.resolve({})),
    formatProfileSummary: vi.fn(() => "Profile Summary")
}));

// Mock DB
vi.mock('../../db/client', () => ({
    db: {
        errorFact: { create: vi.fn(), findFirst: vi.fn() },
        agentRun: { create: vi.fn(() => Promise.resolve({ id: 'run-1' })), update: vi.fn() },
        agentMetrics: { create: vi.fn() },
        fixAttempt: { create: vi.fn() },
        fixTrajectory: { create: vi.fn() },
        fileModification: { create: vi.fn() }
    }
}));

describe('Environment Recovery Integration', () => {
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

    beforeEach(async () => {
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
                classifyError: vi.fn().mockImplementation((logs) => {
                    if (logs.includes('MASS FAILURE')) {
                        return { category: ErrorCategory.ENVIRONMENT_UNSTABLE, confidence: 0.9 };
                    }
                    return { category: ErrorCategory.RUNTIME, confidence: 0.9 };
                }),
                classifyErrorWithHistory: vi.fn().mockResolvedValue({
                    category: ErrorCategory.RUNTIME,
                    confidence: 0.9,
                    errorMessage: 'Runtime Error',
                    affectedFiles: [],
                }),
                getErrorPriority: vi.fn().mockReturnValue(5),
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
                runRepairAgent: vi.fn(),
            } as any,
            metrics: { recordFixAttempt: vi.fn() } as any,
            environment: {
                refreshDependencies: vi.fn(),
                purgeEnvironment: vi.fn(),
                repairPatches: vi.fn(),
                killDanglingProcesses: vi.fn(),
            },
            learning: {
                getStrategyRecommendation: vi.fn().mockResolvedValue({}),
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 0 }),
            },
            learningMetrics: {
                recordMetric: vi.fn(),
            },
            ingestion: {
                ingestRawData: vi.fn(),
            }
        };

        vi.mocked(SandboxService.prepareSandbox).mockResolvedValue(new SimulationSandbox());
        vi.mocked(GitHubService.getWorkflowLogs).mockResolvedValue({ logText: 'Error log...', headSha: 'sha123' });
        vi.mocked(LogAnalysisService.diagnoseError).mockResolvedValue({
            summary: 'Fix me',
            filePath: 'src/file.ts',
            fixAction: 'edit'
        });
        vi.mocked(GitHubService.findClosestFile).mockResolvedValue({
            path: 'src/file.ts',
            file: { name: 'file.ts', content: 'broken code', language: 'typescript' }
        });
        vi.mocked(LogAnalysisService.generateFix).mockResolvedValue('fixed code');
        vi.mocked(LogAnalysisService.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: 'LGTM' });
        vi.mocked(SandboxService.toolLintCheck).mockResolvedValue({ valid: true });
    });

    it('should recover from mass failure during verification', async () => {
        // First run fails with mass failure
        vi.mocked(LogAnalysisService.runSandboxTest)
            .mockResolvedValueOnce({ passed: false, logs: 'MASS FAILURE: 50 tests failed' })
            .mockResolvedValueOnce({ passed: true, logs: 'All tests passed' });

        const result = await runIndependentAgentLoop(config, group, 'ctx', testServices as any, mockUpdateState, mockLog);

        expect(result.status).toBe('success');
        expect(testServices.environment.refreshDependencies).toHaveBeenCalled();
        expect(testServices.environment.killDanglingProcesses).toHaveBeenCalled();
        expect(LogAnalysisService.runSandboxTest).toHaveBeenCalledTimes(2);
    });
});
