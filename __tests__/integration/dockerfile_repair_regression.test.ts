import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import { runIndependentAgentLoop } from '../../agent';
import { AgentPhase } from '../../types';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as SandboxService from '../../services/sandbox/SandboxService.js';
import * as LLMService from '../../services/llm/LLMService.js';
import { SimulationSandbox } from '../../sandbox';
import { DockerfileValidator } from '../../services/analysis/DockerfileValidator.js';

// Mock MOST services, but we want to use REAL LogAnalysisService.generateFix
vi.mock('../../services/github/GitHubService.js');
vi.mock('../../services/sandbox/SandboxService.js');
vi.mock('../../services/llm/LLMService.js');
vi.mock('../../services/analysis/DockerfileValidator.js');
// partial mock for LogAnalysisService - we'll mock some functions but keep generateFix
vi.mock('../../services/analysis/LogAnalysisService.js', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        diagnoseError: vi.fn(),
        generateDetailedPlan: vi.fn(),
        formatPlanToMarkdown: vi.fn().mockReturnValue('Plan MD'),
        runSandboxTest: vi.fn(),
        judgeFix: vi.fn(),
        generateRepoSummary: vi.fn().mockResolvedValue('Repo Summary'),
        refineProblemStatement: vi.fn().mockResolvedValue('Refined')
    };
});

vi.mock('../../db/client.js', () => ({
    db: {
        errorFact: { create: vi.fn().mockResolvedValue({ id: '1' }), findFirst: vi.fn().mockResolvedValue(null) },
        fileModification: { create: vi.fn().mockResolvedValue({}) }
    }
}));

describe('Dockerfile Repair Regression', () => {
    const config = { repoUrl: 'owner/modporter-ai', devEnv: 'simulation' } as any;
    const group = { id: 'g1', runIds: [123], mainRun: { head_sha: 's1' } } as any;
    const mockLog = vi.fn();
    const mockUpdate = vi.fn();

    let testServices: any;

    beforeEach(() => {
        vi.clearAllMocks();
        testServices = {
            github: {
                getWorkflowLogs: vi.fn().mockResolvedValue({ logText: 'docker build failed with exit code 1', headSha: 's1' }),
                findClosestFile: vi.fn().mockResolvedValue({
                    path: 'docker/base-images/Dockerfile.python-base',
                    file: { name: 'Dockerfile.python-base', content: 'FROM python:3.9\nRUN apt-get update && apt-get install -y --no-installfrrecommends curl', language: 'dockerfile' }
                })
            },
            analysis: {
                generateRepoSummary: vi.fn().mockResolvedValue('Repo Summary'),
                diagnoseError: vi.fn().mockResolvedValue({
                    summary: 'Typo in apt-get flag',
                    filePath: 'docker/base-images/Dockerfile.python-base',
                    fixAction: 'edit'
                }),
                generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'fix', tasks: [], approved: true }),
                generateFix: LogAnalysisService.generateFix, // USE REAL ONE
                runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'OK' }),
                judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: 'Fixed' }),
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
            planning: { generateDetailedPlan: vi.fn().mockResolvedValue({ goal: 'fix', tasks: [], approved: true }) },
            discovery: {
                findUniqueFile: vi.fn().mockImplementation(async (filename, rootDir) => ({
                    found: true,
                    path: path.isAbsolute(filename) ? filename : path.join(rootDir || '/simulation', filename),
                    relativePath: filename,
                    matches: [filename]
                })),
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
    });

    it('should correctly fix the specific modporter-ai typo and pass validation', async () => {
        // Mock the LLM generating the fix WITH the typo
        const mockUnifiedGenerate = vi.mocked(LLMService.unifiedGenerate);
        mockUnifiedGenerate.mockResolvedValue({ 
            text: '```dockerfile\nFROM python:3.9\nRUN apt-get update && apt-get install -y --no-installfrrecommends curl\n```'
        } as any);
        
        // Validation should pass because post-processing in generateFix will fix it!
        vi.mocked(DockerfileValidator.validate).mockResolvedValueOnce({ valid: true, issues: [] });
        
        vi.mocked(LogAnalysisService.runSandboxTest).mockResolvedValue({ passed: true, logs: 'Build Success' });
        vi.mocked(LogAnalysisService.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: 'Fixed' });

        const result = await runIndependentAgentLoop(config, group, 'ctx', testServices, (_id, state) => {
            console.log(`[Test] State update: phase=${state.phase}, currentNode=${state.currentNode}, status=${state.status}`);
        }, mockLog);

        console.log('[Test] Final log:', result.activeLog);

        expect(result.status).toBe('success');
        
        // Verify the final file content has the fix applied by post-processor
        const dockerfileChange = result.files['docker/base-images/Dockerfile.python-base'];
        expect(dockerfileChange.modified.content).toContain('--no-install-recommends');
        expect(dockerfileChange.modified.content).not.toContain('--no-installfrrecommends');
    });

    it('should iterate and fix when DockerfileValidator reports errors (feedback loop)', async () => {
        // 1. First attempt: LLM generates code with invalid inline comment
        const badCode = 'FROM python:3.9\nRUN apt-get update # inline comment\n';
        const goodCode = 'FROM python:3.9\nRUN apt-get update\n';

        const mockUnifiedGenerate = vi.mocked(LLMService.unifiedGenerate);
        mockUnifiedGenerate
            .mockResolvedValueOnce({ text: `\`\`\`dockerfile\n${badCode}\n\`\`\`` } as any) // Attempt 1
            .mockResolvedValueOnce({ text: `\`\`\`dockerfile\n${goodCode}\n\`\`\`` } as any); // Attempt 2

        // 2. Validator fails first, passes second
        vi.mocked(DockerfileValidator.validate)
            .mockResolvedValueOnce({ 
                valid: false, 
                issues: [{ level: 'error', message: 'Inline comment not allowed', code: 'DL3000' }] 
            }) // Check 1
            .mockResolvedValueOnce({ valid: true, issues: [] }); // Check 2

        // Mock sandbox/judge for the process
        vi.mocked(LogAnalysisService.runSandboxTest).mockResolvedValue({ passed: true, logs: 'Build Success' });
        vi.mocked(LogAnalysisService.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: 'Fixed' });

        const result = await runIndependentAgentLoop(config, group, 'ctx', testServices, (state) => {
             // Debug log
        }, mockLog);

        expect(result.status).toBe('success');
        
        // Verify final content is the GOOD code
        const dockerfileChange = result.files['docker/base-images/Dockerfile.python-base'];
        expect(dockerfileChange.modified.content).toContain('RUN apt-get update');
        expect(dockerfileChange.modified.content).not.toContain('# inline comment');

        // Verify validator was called twice (or at least more than once)
        expect(DockerfileValidator.validate).toHaveBeenCalledTimes(2);
    });
});
