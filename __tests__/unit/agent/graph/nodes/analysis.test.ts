
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { analysisNode } from '../../../../../agent/graph/nodes/analysis.js';
import { AgentPhase } from '../../../../../types.js';

// Mocks
vi.mock('../../../../../services/github/GitHubService.js', () => ({
    getWorkflowLogs: vi.fn(),
}));

vi.mock('../../../../../services/context-compiler.js', () => ({
    getCachedRepoContext: vi.fn(),
}));

vi.mock('../../../../../db/client.js', () => ({
    db: {
        errorFact: {
            findFirst: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
        },
    },
}));

vi.mock('../../../../../services/dependency-tracker.js', () => ({
    hasBlockingDependencies: vi.fn().mockResolvedValue(false),
    getBlockedErrors: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../../services/error-clustering.js', () => ({
    clusterError: vi.fn(),
}));

import { getWorkflowLogs } from '../../../../../services/github/GitHubService.js';
import { getCachedRepoContext } from '../../../../../services/context-compiler.js';
import { db } from '../../../../../db/client.js';

describe('Analysis Node', () => {
    let mockState: any;
    let mockContext: any;
    let mockServices: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockServices = {
            github: {
                getWorkflowLogs: vi.fn().mockResolvedValue({ logText: 'Error log', jobName: 'test', headSha: 'sha123' }),
            },
            context: {
                smartThinLog: vi.fn().mockResolvedValue('Thinned log'),
            },
            sandbox: {
                toolScanDependencies: vi.fn().mockResolvedValue('Dep report'),
            },
            analysis: {
                generateRepoSummary: vi.fn().mockResolvedValue('Repo Summary'),
                diagnoseError: vi.fn().mockResolvedValue({
                    summary: 'Diagnosis',
                    filePath: 'file.ts',
                    fixAction: 'edit',
                }),
                refineProblemStatement: vi.fn().mockResolvedValue('Refined'),
            },
            classification: {
                classifyErrorWithHistory: vi.fn().mockResolvedValue({
                    category: 'logic',
                    confidence: 0.9,
                    errorMessage: 'Error',
                    affectedFiles: ['file.ts'],
                }),
                getErrorPriority: vi.fn().mockReturnValue(10),
            },
            complexity: {
                estimateComplexity: vi.fn().mockReturnValue(5),
                detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                isAtomic: vi.fn().mockReturnValue(false),
                explainComplexity: vi.fn().mockReturnValue('Complexity explanation'),
            },
            dependency: {
                hasBlockingDependencies: vi.fn().mockResolvedValue(false),
                getBlockedErrors: vi.fn().mockResolvedValue([]),
            },
            clustering: {
                clusterError: vi.fn(),
            },
            metrics: {
                recordReproductionInference: vi.fn(),
            },
            reproductionInference: {
                inferCommand: vi.fn().mockResolvedValue({
                    command: 'npm test inferred',
                    strategy: 'safe_scan'
                })
            }
        };

        mockContext = {
            logCallback: vi.fn(),
            sandbox: {
                getLocalPath: vi.fn().mockReturnValue('/mock/repo')
            },
            profile: {},
            dbClient: db,
            services: mockServices,
        };

        mockState = {
            config: { repoUrl: 'owner/repo', githubToken: 'token' },
            group: { id: 'group-1', runIds: [123], mainRun: { head_sha: 'sha123' } },
            iteration: 0,
            currentLogText: 'Error message',
            feedback: [],
            complexityHistory: [],
        };

        (getCachedRepoContext as Mock).mockResolvedValue('Repo Context');
    });

    it('should diagnose error and transition to planning', async () => {
        const result = await analysisNode(mockState, mockContext);

        expect(mockServices.classification.classifyErrorWithHistory).toHaveBeenCalled();
        expect(mockServices.analysis.diagnoseError).toHaveBeenCalled();
        expect(db.errorFact.create).toHaveBeenCalled();
        expect(result.currentNode).toBe('planning');
        expect(result.diagnosis).toBeDefined();
    });

    it('should fetch logs if currentLogText is missing', async () => {
        mockState.currentLogText = '';
        
        await analysisNode(mockState, mockContext);

        expect(mockServices.github.getWorkflowLogs).toHaveBeenCalled();
        expect(mockServices.context.smartThinLog).toHaveBeenCalled();
    });

    it('should handle blocking dependencies', async () => {
        mockServices.dependency.hasBlockingDependencies.mockResolvedValueOnce(true);
        mockServices.dependency.getBlockedErrors.mockResolvedValueOnce([{
            blockedBy: [{ summary: 'Blocker' }]
        }]);

        const result = await analysisNode(mockState, mockContext);

        expect(result.status).toBe('failed');
        expect(result.failureReason).toContain('blocked');
    });

    it('should refine problem statement if feedback exists', async () => {
        mockState.feedback = ['Refine this'];
        
        await analysisNode(mockState, mockContext);

        expect(mockServices.analysis.refineProblemStatement).toHaveBeenCalled();
    });

    it('should correctly handle Dockerfile validation feedback', async () => {
        const dockerFeedback = 'Dockerfile Validation Failed for Dockerfile:\n[ERROR] Line 2: comment error (SC100)';
        mockState.feedback = [dockerFeedback];
        mockState.iteration = 1;

        await analysisNode(mockState, mockContext);

        expect(mockServices.analysis.diagnoseError).toHaveBeenCalledWith(
            expect.anything(), // config
            expect.anything(), // currentLogText
            expect.anything(), // diagContext
            expect.anything(), // profile
            expect.anything(), // classificationForDiagnosis
            expect.arrayContaining([dockerFeedback]) // feedbackHistory
        );
        expect(mockServices.analysis.refineProblemStatement).toHaveBeenCalledWith(
            expect.anything(), // config
            expect.objectContaining({ summary: 'Diagnosis' }), // diagnosis
            expect.arrayContaining([dockerFeedback]), // feedback
            undefined // previousStatement
        );
    });

    it('should infer reproduction command if missing from diagnosis', async () => {
        mockServices.analysis.diagnoseError.mockResolvedValueOnce({
            summary: 'Diagnosis',
            filePath: 'file.ts',
            fixAction: 'edit',
            reproductionCommand: undefined
        });

        await analysisNode(mockState, mockContext);

        expect(mockServices.reproductionInference.inferCommand).toHaveBeenCalled();
        expect(mockContext.logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Inferred command: npm test inferred'));
    });
});
