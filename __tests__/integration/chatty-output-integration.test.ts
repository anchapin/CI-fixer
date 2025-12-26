import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AppConfig, RunGroup, AgentPhase } from '../../types';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';

// Mock DB
function createMockDb() {
    return {
        errorFact: { findFirst: vi.fn(() => Promise.resolve(null)), create: vi.fn(() => Promise.resolve({ id: '1' })) },
        fileModification: { create: vi.fn(() => Promise.resolve({})) },
        fixPattern: { findFirst: vi.fn(() => Promise.resolve(null)), create: vi.fn(() => Promise.resolve({})) },
        errorSolution: { findFirst: vi.fn(() => Promise.resolve(null)), create: vi.fn(() => Promise.resolve({})) },
        actionTemplate: { findFirst: vi.fn(() => Promise.resolve(null)), update: vi.fn(() => Promise.resolve({})) },
        errorDependency: { create: vi.fn(() => Promise.resolve({})) },
        errorCluster: { create: vi.fn(() => Promise.resolve({})), update: vi.fn(() => Promise.resolve({})) },
        agentRun: { create: vi.fn(() => Promise.resolve({})), update: vi.fn(() => Promise.resolve({})) },
        agentMetrics: { create: vi.fn(() => Promise.resolve({})) },
        fixAttempt: { create: vi.fn(() => Promise.resolve({})) },
        repositoryPreferences: { findFirst: vi.fn(() => Promise.resolve(null)) },
        fixTrajectory: { create: vi.fn(() => Promise.resolve({})) }
    };
}

vi.mock('../../db/client', () => ({ db: createMockDb() }));

// Mock Services
vi.mock('../../services/analysis/CodeAnalysisService.js', () => ({
    extractFileOutline: vi.fn()
}));
vi.mock('../../services/analysis/LogAnalysisService.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        diagnoseError: vi.fn(),
        generateDetailedPlan: vi.fn(),
        formatPlanToMarkdown: vi.fn().mockReturnValue("Plan MD"),
        judgeFix: vi.fn(),
        runSandboxTest: vi.fn(),
        generateRepoSummary: vi.fn().mockResolvedValue("Mock Repo Summary")
    };
});
vi.mock('../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn(),
    findClosestFile: vi.fn()
}));
vi.mock('../../services/sandbox/SandboxService.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        toolScanDependencies: vi.fn(),
        toolCodeSearch: vi.fn(),
        toolSemanticCodeSearch: vi.fn(),
        toolWebSearch: vi.fn(),
        toolLintCheck: vi.fn(),
        prepareSandbox: vi.fn()
    };
});
vi.mock('../../services/llm/LLMService', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        unifiedGenerate: vi.fn()
    };
});

// Mock Validation to avoid GitHub API calls
vi.mock('../../validation', () => ({
    validateFileExists: vi.fn(() => Promise.resolve(true)),
    validateCommand: vi.fn((cmd) => ({ valid: true, command: cmd })),
    analyzeRepository: vi.fn(() => Promise.resolve({
        languages: ['typescript'],
        packageManager: 'npm',
        buildSystem: 'vite',
        testFramework: 'vitest'
    })),
    formatProfileSummary: vi.fn(() => "Mock Profile Summary")
}));

describe('Chatty Output Integration', () => {
    const mockUpdateState = vi.fn();
    const mockLog = vi.fn();

    const config: AppConfig = {
        githubToken: 'test-token',
        repoUrl: 'owner/repo',
        llmProvider: 'gemini',
        devEnv: 'simulation'
    } as any;

    const group: RunGroup = {
        id: 'run-chatty',
        name: 'Chatty Test Run',
        runIds: [1],
        mainRun: { head_sha: 'sha1' },
        status: 'pending'
    } as any;

    let testServices: any;
    let mockSandbox: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        
        mockSandbox = new SimulationSandbox();
        mockSandbox.writeFile = vi.fn();
        mockSandbox.runCommand = vi.fn(() => Promise.resolve({ stdout: '', exitCode: 0 }));

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
                classifyErrorWithHistory: vi.fn().mockResolvedValue({
                    category: 'logic',
                    confidence: 0.9,
                    errorMessage: 'Error',
                    affectedFiles: ['requirements.txt'],
                }),
                classifyError: vi.fn().mockResolvedValue({
                    category: 'logic',
                    confidence: 0.9,
                    errorMessage: 'Error',
                    affectedFiles: ['requirements.txt'],
                }),
                getErrorPriority: vi.fn().mockReturnValue(5),
            } as any,
            ingestion: {
                ingestRawData: vi.fn().mockResolvedValue({ id: 'mock-ingestion-id' }),
            } as any,
            learningMetrics: {
                recordMetric: vi.fn().mockResolvedValue(undefined),
            } as any,
            discovery: {
                findUniqueFile: vi.fn().mockImplementation(async (filename, rootDir) => ({
                    found: true,
                    path: filename,
                    relativePath: filename,
                    matches: [filename]
                })),
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
            } as any,
            learning: {
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 10.0 }),
                getStrategyRecommendation: vi.fn().mockResolvedValue({ strategy: 'direct', confidence: 0.9 })
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
            repairAgent: { getRepairAgentConfig: vi.fn().mockReturnValue({}), runRepairAgent: vi.fn() } as any,
            metrics: { recordFixAttempt: vi.fn() } as any,
        };

        // LLM Mocks
        vi.mocked(LLMService.unifiedGenerate).mockImplementation(async (conf, params) => {
            // Simulate chatty output for code generation
            if (params.contents.includes('Error: requirements.txt')) {
                return { text: 'Of course! Here is the fix for requirements.txt:\n```\npython-dotenv==1.2.1\n```\nI hope this helps!' };
            }
            // Default response for other calls (diagnosis, judge, etc.)
            return { text: JSON.stringify({ summary: 'Fix requirements', filePath: 'requirements.txt', fixAction: 'edit', passed: true, score: 10 }) };
        });

        vi.mocked(SandboxService.prepareSandbox).mockResolvedValue(mockSandbox);
        vi.mocked(GitHubService.getWorkflowLogs).mockResolvedValue({ logText: 'Error: requirements.txt failure', headSha: 'sha1' });
        vi.mocked(LogAnalysisService.diagnoseError).mockResolvedValue({
            summary: 'Error: requirements.txt failure',
            filePath: 'requirements.txt',
            fixAction: 'edit'
        });
        vi.mocked(GitHubService.findClosestFile).mockResolvedValue({
            path: 'requirements.txt',
            file: { name: 'requirements.txt', content: 'python-dotenv==1.0.0', language: 'text' }
        });
        vi.mocked(SandboxService.toolLintCheck).mockResolvedValue({ valid: true });
        vi.mocked(LogAnalysisService.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: 'LGTM' });
        vi.mocked(LogAnalysisService.runSandboxTest).mockResolvedValue({ passed: true, logs: 'Tests Passed' });
    });

    it('should strip conversational filler from the generated fix before writing to sandbox', async () => {
        await runIndependentAgentLoop(config, group, 'ctx', testServices as any, mockUpdateState, mockLog);

        // Verify that mockSandbox.writeFile was called with CLEAN content for requirements.txt
        const writeFileCalls = mockSandbox.writeFile.mock.calls;
        const requirementsCall = writeFileCalls.find(call => call[0] === 'requirements.txt');
        
        expect(requirementsCall).toBeDefined();
        expect(requirementsCall[1]).toBe('python-dotenv==1.2.1');
    });
});
