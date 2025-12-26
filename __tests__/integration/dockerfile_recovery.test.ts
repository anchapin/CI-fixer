
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AgentPhase } from '../../types';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';
import { DockerfileValidator } from '../../services/analysis/DockerfileValidator.js';

// Mock everything
vi.mock('../../services/analysis/LogAnalysisService.js');
vi.mock('../../services/github/GitHubService.js');
vi.mock('../../services/sandbox/SandboxService.js');
vi.mock('../../services/llm/LLMService.js');
vi.mock('../../services/analysis/DockerfileValidator.js');
vi.mock('../../db/client.js', () => ({
    db: {
        errorFact: { create: vi.fn().mockResolvedValue({ id: '1' }), findFirst: vi.fn().mockResolvedValue(null) },
        fileModification: { create: vi.fn().mockResolvedValue({}) }
    }
}));

describe('Dockerfile Recovery Integration', () => {
    const config = { repoUrl: 'owner/repo', devEnv: 'simulation' } as any;
    const group = { id: 'g1', runIds: [123], mainRun: { head_sha: 's1' } } as any;
    const mockLog = vi.fn();
    const mockUpdate = vi.fn();

    let testServices: any;

    beforeEach(() => {
        vi.clearAllMocks();
        testServices = {
            github: {
                getWorkflowLogs: vi.fn().mockResolvedValue({ logText: 'Error', headSha: 's1' }),
                findClosestFile: vi.fn().mockResolvedValue({
                    path: 'Dockerfile',
                    file: { name: 'Dockerfile', content: 'FROM node', language: 'dockerfile' }
                })
            },
            analysis: {
                generateRepoSummary: vi.fn().mockResolvedValue('Repo Summary'),
                diagnoseError: vi.fn().mockResolvedValue({
                    summary: 'Fix Dockerfile',
                    filePath: 'Dockerfile',
                    fixAction: 'edit'
                }),
                generateFix: vi.fn(),
                runSandboxTest: vi.fn(),
                judgeFix: vi.fn(),
                generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'fix', tasks: [], approved: true }),
                refineProblemStatement: vi.fn().mockResolvedValue('Refined'),
                formatPlanToMarkdown: vi.fn().mockReturnValue('Plan MD')
            },
            sandbox: {
                prepareSandbox: vi.fn().mockResolvedValue(new SimulationSandbox()),
                toolScanDependencies: vi.fn().mockResolvedValue('Dep report'),
                toolLintCheck: vi.fn().mockResolvedValue({ valid: true })
            },
            llm: LLMService,
            context: {
                smartThinLog: vi.fn().mockImplementation(async (l) => l),
                thinLog: vi.fn().mockImplementation((l) => l),
                markNodeSolved: vi.fn().mockReturnValue({ solvedNodes: [] }),
            },
            classification: {
                classifyErrorWithHistory: vi.fn().mockResolvedValue({ category: 'syntax' }),
                getErrorPriority: vi.fn().mockReturnValue(5),
            },
            dependency: { hasBlockingDependencies: vi.fn().mockResolvedValue(false) },
            clustering: { clusterError: vi.fn() },
            complexity: {
                estimateComplexity: vi.fn().mockReturnValue(1),
                detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                isAtomic: vi.fn().mockReturnValue(true),
                explainComplexity: vi.fn().mockReturnValue('low'),
            },
            learning: {
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 1 }),
                getStrategyRecommendation: vi.fn().mockResolvedValue({ strategy: 'direct', confidence: 0.9 })
            },
            metrics: { recordFixAttempt: vi.fn() },
            ingestion: { ingestRawData: vi.fn().mockResolvedValue({}) },
            planning: { generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'fix', tasks: [] }) },
            discovery: {
                findUniqueFile: vi.fn().mockResolvedValue({ found: true, path: 'Dockerfile', relativePath: 'Dockerfile', matches: ['Dockerfile'] }),
                recursiveSearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForRename: vi.fn().mockResolvedValue(null),
                fuzzySearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForDeletion: vi.fn().mockResolvedValue(false)
            },
            verification: {
                verifyContentMatch: vi.fn().mockResolvedValue(true)
            },
            fallback: {
                generatePlaceholder: vi.fn().mockResolvedValue(undefined)
            }
        };

        // For the graph, we need to mock planning node result if needed, but runIndependentAgentLoop handles it.
    });

    it('should recover from a self-introduced Dockerfile syntax error', async () => {
        // 1st attempt: Agent generates BAD code (with inline comment)
        vi.mocked(testServices.analysis.generateFix).mockResolvedValueOnce('FROM node\nRUN # bad comment');
        
        // Validation fails for the bad code
        vi.mocked(DockerfileValidator.validate).mockResolvedValueOnce({
            valid: false,
            issues: [{ level: 'error', message: 'Inline comment', code: 'SC100', line: 2 }]
        });

        // 2nd attempt: Agent generates GOOD code (corrected)
        vi.mocked(testServices.analysis.generateFix).mockResolvedValueOnce('FROM node\nRUN echo hi');
        
        // Validation passes for the good code
        vi.mocked(DockerfileValidator.validate).mockResolvedValueOnce({ valid: true, issues: [] });
        
        // Full suite passes
        vi.mocked(testServices.analysis.runSandboxTest).mockResolvedValue({ passed: true, logs: 'OK' });
        vi.mocked(testServices.analysis.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: 'Fixed' });

        const result = await runIndependentAgentLoop(config, group, 'ctx', testServices, mockUpdate, mockLog);

        expect(result.status).toBe('success');
        expect(testServices.analysis.generateFix).toHaveBeenCalledTimes(2);
        expect(DockerfileValidator.validate).toHaveBeenCalledTimes(2);
        
        // Verify that the second call to refineProblemStatement received the feedback
        expect(testServices.analysis.refineProblemStatement).toHaveBeenCalledWith(
            expect.anything(), // config
            expect.objectContaining({ filePath: 'Dockerfile' }), // diagnosis
            expect.arrayContaining([expect.stringContaining('Dockerfile Validation Failed')]), // feedback
            undefined // previousStatement
        );
    });
});
