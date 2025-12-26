
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AppConfig, RunGroup, AgentPhase } from '../../types';
import { LoopDetector } from '../../services/LoopDetector';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';

describe('Hallucination Loop E2E (Mocked)', () => {
    const mockUpdateState = vi.fn();
    const mockLog = vi.fn();

    const config: AppConfig = {
        githubToken: 'test-token',
        repoUrl: 'owner/repo',
        llmProvider: 'openai',
        devEnv: 'simulation'
    } as any;

    const group: RunGroup = {
        id: 'run-hallucinate',
        name: 'Hallucination Run',
        runIds: [123],
        mainRun: { head_sha: 'sha123' },
        status: 'pending',
        created_at: new Date()
    } as any;

    let testServices: any;
    let loopDetector: LoopDetector;

    beforeEach(async () => {
        vi.clearAllMocks();
        loopDetector = new LoopDetector();
        
        testServices = {
            github: {
                getWorkflowLogs: vi.fn().mockResolvedValue({ logText: 'Error', headSha: 'sha123' }),
                findClosestFile: vi.fn().mockResolvedValue(null) // Simulate file not found
            },
            analysis: {
                generateRepoSummary: vi.fn().mockResolvedValue('summary'),
                diagnoseError: vi.fn().mockResolvedValue({ 
                    summary: 'Fix the missing file', 
                    filePath: 'non_existent.ts', 
                    fixAction: 'edit' 
                }),
                generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'fix', tasks: [] }),
                formatPlanToMarkdown: vi.fn().mockReturnValue('Plan'),
                generateFix: vi.fn().mockResolvedValue('fixed code'),
                judgeFix: vi.fn().mockResolvedValue({ passed: false, score: 0, reasoning: 'File not found' }),
                refineProblemStatement: vi.fn().mockResolvedValue('refined'),
                runSandboxTest: vi.fn().mockResolvedValue({ passed: false, logs: 'Error: Path NOT FOUND' })
            },
            sandbox: {
                prepareSandbox: vi.fn().mockResolvedValue(new SimulationSandbox()),
                toolScanDependencies: vi.fn(),
                toolLintCheck: vi.fn().mockResolvedValue({ valid: true })
            },
            context: {
                smartThinLog: vi.fn(l => l),
                thinLog: vi.fn(l => l),
                markNodeSolved: vi.fn(s => ({ solvedNodes: [] }))
            },
            classification: {
                classifyErrorWithHistory: vi.fn().mockResolvedValue({ category: 'runtime', errorMessage: 'err' }),
                getErrorPriority: vi.fn().mockReturnValue(3)
            },
            complexity: {
                estimateComplexity: vi.fn().mockReturnValue(5),
                detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                isAtomic: vi.fn().mockReturnValue(false),
                explainComplexity: vi.fn().mockReturnValue('low')
            },
            loopDetector,
            metrics: { recordFixAttempt: vi.fn() },
            learningMetrics: { recordMetric: vi.fn() },
            ingestion: { ingestRawData: vi.fn() },
            learning: { 
                getStrategyRecommendation: vi.fn().mockResolvedValue({ historicalStats: { successRate: 0 } }),
                recordMetric: vi.fn()
            },
            discovery: {
                findUniqueFile: vi.fn().mockResolvedValue({ found: false, matches: [] })
            }
        };
    });

    it('should trigger strategy shift warning after 2 path hallucinations in the loop', async () => {
        // We'll run 3 iterations.
        // Iteration 1: Hallucinates non_existent.ts
        // Iteration 2: Hallucinates non_existent.ts again
        // Iteration 3: Analysis node should see 2 hallucinations and inject warning
        
        // Mock the sequence of diagnosis
        vi.mocked(testServices.analysis.diagnoseError)
            .mockResolvedValueOnce({ summary: 'Attempt 1', filePath: 'non_existent.ts', fixAction: 'edit' })
            .mockResolvedValueOnce({ summary: 'Attempt 2', filePath: 'non_existent.ts', fixAction: 'edit' })
            .mockResolvedValueOnce({ summary: 'Attempt 3', filePath: 'non_existent.ts', fixAction: 'edit' });

        // We need to simulate the recording of hallucinations.
        // In the real app, this happens in toolRunCodeMode or graph nodes.
        // In this mocked E2E, we manually record them to simulate the middleware impact.
        
        // Actually, the graph node calls loopDetector.detectLoop(snapshot) and loopDetector.addState(snapshot).
        // But for path hallucinations, it's the tools that report it.
        
        // Let's mock services.discovery.findUniqueFile to also record hallucination if we want
        // Or just let the analysis node logic do its thing if we pre-populate the loop detector.
        
        loopDetector.recordHallucination('non_existent.ts');
        loopDetector.recordHallucination('non_existent.ts');

        await runIndependentAgentLoop(config, group, 'ctx', testServices as any, mockUpdateState, mockLog);

        // Verify diagnoseError was called with the warning in the 3rd iteration (which is iteration 2 in 0-index)
        // Wait, runIndependentAgentLoop might stop if it fails.
        // But our mocks are set to continue.
        
        expect(testServices.analysis.diagnoseError).toHaveBeenCalledWith(
            expect.any(Object),
            expect.stringContaining('STRATEGY SHIFT REQUIRED'),
            expect.any(String),
            undefined,
            expect.any(Object),
            expect.any(Array)
        );
    });
});
