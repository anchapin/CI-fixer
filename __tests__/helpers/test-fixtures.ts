import { vi } from 'vitest';
import * as path from 'node:path';
import { GraphState, GraphContext } from '../../agent/graph/state.js';
import { AppConfig, RunGroup, WorkflowRun, FileChange } from '../../types.js';
import { SimulationSandbox } from '../../sandbox.js';
import { ServiceContainer } from '../../services/container.js';
import { DiagnosisResult } from '../../services/analysis/LogAnalysisService.js';
import { ClassifiedError, ErrorCategory } from '../../errorClassification.js';

/**
 * Default mock configuration for tests
 */
export const createMockConfig = (overrides?: Partial<AppConfig>): AppConfig => ({
    githubToken: 'test-token',
    repoUrl: 'https://github.com/test/repo',
    selectedRuns: [],
    llmProvider: 'gemini',
    devEnv: 'simulation',
    checkEnv: 'simulation',
    ...overrides
});

/**
 * Default mock workflow run
 */
export const createMockWorkflowRun = (overrides?: Partial<WorkflowRun>): WorkflowRun => ({
    id: 123,
    name: 'Test Workflow',
    path: '.github/workflows/test.yml',
    status: 'failed',
    conclusion: 'failure',
    head_sha: 'abc123',
    head_branch: 'main',
    html_url: 'https://github.com/test/repo/actions/runs/123',
    ...overrides
});

/**
 * Default mock run group
 */
export const createMockRunGroup = (overrides?: Partial<RunGroup>): RunGroup => ({
    id: 'test-group-1',
    name: 'Test Group',
    runIds: [123],
    mainRun: createMockWorkflowRun(),
    ...overrides
});

/**
 * Default mock diagnosis result
 */
export const createMockDiagnosis = (overrides?: Partial<DiagnosisResult>): DiagnosisResult => ({
    summary: 'Test error summary',
    filePath: 'src/app.ts',
    fixAction: 'edit',
    suggestedCommand: null,
    ...overrides
});

/**
 * Default mock classification
 */
export const createMockClassification = (overrides?: Partial<ClassifiedError>): ClassifiedError => ({
    category: ErrorCategory.RUNTIME,
    confidence: 0.85,
    affectedFiles: ['src/app.ts'],
    suggestedAction: 'Fix runtime error',
    rootCauseLog: 'Error: Test error',
    cascadingErrors: [],
    errorMessage: 'Test error',
    ...overrides
});

/**
 * Default mock file change
 */
export const createMockFileChange = (path: string, overrides?: Partial<FileChange>): FileChange => ({
    path,
    original: {
        name: path.split('/').pop() || 'file.ts',
        language: 'typescript',
        content: 'const x = 1;'
    },
    modified: {
        name: path.split('/').pop() || 'file.ts',
        language: 'typescript',
        content: 'const x = 2;'
    },
    status: 'modified',
    ...overrides
});

/**
 * Creates a mock GraphState with sensible defaults
 */
export const createMockGraphState = (overrides?: Partial<GraphState>): GraphState => ({
    config: createMockConfig(),
    group: createMockRunGroup(),
    activeLog: 'test-log',
    currentNode: 'analysis',
    iteration: 0,
    maxIterations: 3,
    status: 'working',
    initialRepoContext: 'Mock repo context',
    initialLogText: 'Error: Test error',
    currentLogText: 'Error: Test error',
    files: {},
    fileReservations: [],
    history: [],
    feedback: [],
    complexityHistory: [],
    solvedNodes: [],
    ...overrides
});

/**
 * Creates mock services with spies
 */
export const createMockServices = (overrides?: Partial<ServiceContainer>): ServiceContainer => {
    const services: ServiceContainer = {
        llm: {
            unifiedGenerate: vi.fn().mockResolvedValue({ text: 'Mock LLM response', toolCalls: [] }),
            safeJsonParse: vi.fn().mockImplementation((text, fallback) => {
                try { return JSON.parse(text); } catch { return fallback; }
            }),
            extractCode: vi.fn().mockImplementation((text) => text)
        } as any,
        github: {
            getWorkflowLogs: vi.fn().mockResolvedValue({ logText: 'Mock logs', headSha: 'abc123', jobName: 'test' }),
            findClosestFile: vi.fn().mockResolvedValue({
                file: { name: 'app.ts', content: 'const x = 1;', language: 'typescript' },
                path: 'src/app.ts'
            }),
            getFileContent: vi.fn().mockResolvedValue({ name: 'app.ts', content: 'const x = 1;', language: 'typescript' })
        } as any,
        sandbox: {
            toolCodeSearch: vi.fn().mockResolvedValue([]),
            toolWebSearch: vi.fn().mockResolvedValue(''),
            toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
            toolScanDependencies: vi.fn().mockResolvedValue('No dependencies found'),
            toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
            prepareSandbox: vi.fn().mockResolvedValue({
                getId: () => 'mock-sandbox',
                init: vi.fn(),
                teardown: vi.fn(),
                runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
                writeFile: vi.fn(),
                readFile: vi.fn().mockResolvedValue('const x = 1;'),
                getWorkDir: () => '/simulation'
            })
        } as any,
        analysis: {
            diagnoseError: vi.fn().mockResolvedValue(createMockDiagnosis()),
            generateRepoSummary: vi.fn().mockResolvedValue('Mock repo summary'),
            generateDetailedPlan: vi.fn().mockResolvedValue({
                goal: 'Fix error',
                tasks: [{ id: '1', description: 'Fix', status: 'pending' }],
                approved: true
            }),
            formatPlanToMarkdown: vi.fn().mockReturnValue('# Plan'),
            generateFix: vi.fn().mockResolvedValue('const x = 2;'),
            judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: 'Good fix' }),
            runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'Tests passed' }),
            refineProblemStatement: vi.fn().mockImplementation((config, diag) => diag.summary)
        } as any,
        context: {
            smartThinLog: vi.fn().mockImplementation(async (log) => log),
            thinLog: vi.fn().mockImplementation((log) => log),
            formatHistorySummary: vi.fn().mockReturnValue('History'),
            formatPlanToMarkdown: vi.fn().mockReturnValue('Plan'),
            markNodeSolved: vi.fn().mockReturnValue({ solvedNodes: [] }),
        } as any,
        classification: {
            classifyErrorWithHistory: vi.fn().mockResolvedValue(createMockClassification()),
            classifyError: vi.fn().mockReturnValue(createMockClassification()),
            getErrorPriority: vi.fn().mockReturnValue(5)
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
            findUniqueFile: vi.fn().mockImplementation(async (filename, rootDir) => ({
                found: true,
                path: path.isAbsolute(filename) ? filename : path.join(rootDir || '/', filename),
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
        } as any
    };

    if (overrides) {
        Object.keys(overrides).forEach(key => {
            if (overrides[key as keyof ServiceContainer]) {
                services[key as keyof ServiceContainer] = {
                    ...services[key as keyof ServiceContainer],
                    ...overrides[key as keyof ServiceContainer]
                } as any;
            }
        });
    }

    return services;
};

/**
 * Creates a mock GraphContext with sensible defaults
 */
export const createMockGraphContext = async (overrides?: Partial<GraphContext>): Promise<GraphContext> => {
    const sandbox = new SimulationSandbox();
    await sandbox.init();

    return {
        sandbox,
        services: createMockServices(),
        profile: undefined,
        updateStateCallback: vi.fn(),
        logCallback: vi.fn(),
        dbClient: undefined,
        ...overrides
    };
};

/**
 * Creates a minimal mock context (no sandbox initialization)
 */
export const createMinimalMockContext = (overrides?: Partial<GraphContext>): GraphContext => ({
    sandbox: undefined,
    services: createMockServices(),
    profile: undefined,
    updateStateCallback: vi.fn(),
    logCallback: vi.fn(),
    dbClient: undefined,
    ...overrides
});

/**
 * Helper to clean up mock context
 */
export const cleanupMockContext = async (context: GraphContext): Promise<void> => {
    if (context.sandbox) {
        await context.sandbox.teardown();
    }
};
