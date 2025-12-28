import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analysisNode } from '../../agent/graph/nodes/analysis.js';
import { AgentPhase, LanguageScope } from '../../types.js';
import { GraphState, GraphContext } from '../../agent/graph/state.js';

// Mock Services
const mockServices = {
    github: {
        getWorkflowLogs: vi.fn(),
    },
    context: {
        smartThinLog: vi.fn().mockImplementation(async (log) => log),
    },
    classification: {
        classifyErrorWithHistory: vi.fn(),
        getErrorPriority: vi.fn().mockReturnValue(1),
    },
    analysis: {
        generateRepoSummary: vi.fn().mockResolvedValue('Repo Summary'),
        diagnoseError: vi.fn(),
    },
    sandbox: {
        toolScanDependencies: vi.fn(),
    },
    dependency: {
        hasBlockingDependencies: vi.fn().mockResolvedValue(false),
        getBlockedErrors: vi.fn().mockResolvedValue([]),
    },
    clustering: {
        clusterError: vi.fn(),
    },
    complexity: {
        estimateComplexity: vi.fn().mockReturnValue(5),
        detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
        isAtomic: vi.fn().mockReturnValue(false),
        explainComplexity: vi.fn().mockReturnValue('Complexity'),
    },
    loopDetector: {
        detectLoop: vi.fn().mockReturnValue({ detected: false }),
        addState: vi.fn(),
        getTotalHallucinations: vi.fn().mockReturnValue(0),
    }
};

const mockUpdateStateCallback = vi.fn();
const mockLogCallback = vi.fn();

describe('Agent Scoping Integration', () => {
    let state: GraphState;
    let context: GraphContext;

    beforeEach(() => {
        vi.clearAllMocks();

        state = {
            config: {
                githubToken: 'test-token',
                repoUrl: 'owner/repo',
            } as any,
            group: {
                id: 'group-1',
                name: 'Test Group',
                runIds: [123],
                mainRun: { head_sha: 'sha123' }
            } as any,
            activeLog: '',
            currentNode: 'analysis',
            iteration: 0,
            maxIterations: 5,
            status: 'working',
            initialRepoContext: '',
            initialLogText: '',
            currentLogText: 'sh: 1: vitest: not found',
            files: {},
            fileReservations: [],
            history: [],
            feedback: [],
            complexityHistory: [],
            solvedNodes: []
        };

        context = {
            sandbox: {
                getId: () => 'test-sandbox',
                runCommand: vi.fn(),
                writeFile: vi.fn(),
                readFile: vi.fn(),
                getWorkDir: () => '/tmp',
                teardown: vi.fn(),
                init: vi.fn(),
            } as any,
            services: mockServices as any,
            profile: {
                languages: ['typescript'],
                packageManager: 'npm',
                buildSystem: 'vite',
                testFramework: 'vitest',
                availableScripts: { test: 'vitest' },
                directoryStructure: { hasBackend: false, hasFrontend: true, testDirectories: [], sourceDirectories: [] },
                configFiles: ['package.json', 'vitest.config.ts'],
                repositorySize: 100
            },
            updateStateCallback: mockUpdateStateCallback,
            logCallback: mockLogCallback
        };
    });

    it('should pass detected JS_TS scope to diagnosis', async () => {
        const mockLogs = 'sh: 1: vitest: not found';
        mockServices.github.getWorkflowLogs.mockResolvedValue({ logText: mockLogs });
        
        // Mock classification to return JS_TS scope
        mockServices.classification.classifyErrorWithHistory.mockResolvedValue({
            category: 'infrastructure',
            confidence: 0.9,
            errorMessage: 'vitest: not found',
            affectedFiles: [],
            scope: LanguageScope.JS_TS
        });

        mockServices.analysis.diagnoseError.mockResolvedValue({
            summary: 'Vitest missing',
            filePath: 'package.json',
            fixAction: 'command'
        });

        const updates = await analysisNode(state, context);

        // Check if classifyErrorWithHistory was called with the profile
        expect(mockServices.classification.classifyErrorWithHistory).toHaveBeenCalledWith(
            expect.stringContaining('vitest: not found'),
            context.profile
        );

        // Check if diagnoseError was called with the classification INCLUDING the scope
        expect(mockServices.analysis.diagnoseError).toHaveBeenCalledWith(
            expect.any(Object),
            expect.any(String),
            expect.any(String),
            context.profile,
            expect.objectContaining({
                scope: LanguageScope.JS_TS
            }),
            expect.any(Array)
        );

        expect(updates.classification?.scope).toBe(LanguageScope.JS_TS);
    });
});
