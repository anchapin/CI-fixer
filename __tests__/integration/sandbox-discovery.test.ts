import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AppConfig, RunGroup, AgentPhase } from '../../types';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';

// --- MOCKS ---
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

describe('Sandbox File Discovery Integration', () => {
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
            discovery: {
                recursiveSearch: vi.fn().mockResolvedValue(null),
                fuzzySearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForRename: vi.fn().mockResolvedValue(null),
                checkGitHistoryForDeletion: vi.fn().mockResolvedValue(false),
            },
            verification: {
                verifyContentMatch: vi.fn().mockResolvedValue(true),
                dryRunBuild: vi.fn().mockResolvedValue(true),
            },
            fallback: {
                generatePlaceholder: vi.fn().mockResolvedValue(undefined),
                isReferenceStale: vi.fn().mockResolvedValue(false),
                proposeReferenceRemoval: vi.fn().mockResolvedValue(''),
            },
            context: {
                smartThinLog: vi.fn().mockImplementation(async (log) => log),
                thinLog: vi.fn().mockImplementation((log) => log),
                formatHistorySummary: vi.fn().mockReturnValue('History'),
                formatPlanToMarkdown: vi.fn().mockReturnValue('Plan'),
                markNodeSolved: vi.fn().mockReturnValue({ solvedNodes: [] }),
            } as any,
            classification: {
                classifyErrorWithHistory: vi.fn().mockResolvedValue({
                    category: 'dependency',
                    confidence: 0.9,
                    errorMessage: 'File not found: ai-engine-requirements.txt',
                    affectedFiles: ['ai-engine-requirements.txt'],
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
                runRepairAgent: vi.fn().mockResolvedValue({ status: 'success' }),
            } as any,
            metrics: { recordFixAttempt: vi.fn() } as any,
            learning: {
                getStrategyRecommendation: vi.fn().mockResolvedValue({}),
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 0 }),
            },
            learningMetrics: {
                recordMetric: vi.fn(),
            }
        };

        vi.mocked(SandboxService.prepareSandbox).mockResolvedValue(new SimulationSandbox());
        vi.mocked(GitHubService.getWorkflowLogs).mockResolvedValue({ logText: 'Error log...', headSha: 'sha123' });
        vi.mocked(LogAnalysisService.diagnoseError).mockResolvedValue({
            summary: 'Missing requirements file',
            filePath: 'ai-engine-requirements.txt',
            fixAction: 'edit'
        });
        vi.mocked(GitHubService.findClosestFile).mockResolvedValue(null);
    });

    it('should use FileDiscoveryService when a file is missing', async () => {
        // Setup discovery mock to return a path
        testServices.discovery.recursiveSearch.mockResolvedValue('./src/real-requirements.txt');
        testServices.verification.verifyContentMatch.mockResolvedValue(true);

        await runIndependentAgentLoop(config, group, 'ctx', testServices as any, mockUpdateState, mockLog);

        expect(testServices.discovery.recursiveSearch).toHaveBeenCalled();
        expect(testServices.verification.verifyContentMatch).toHaveBeenCalled();
    });
});
