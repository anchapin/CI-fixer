
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { planningNode } from '../../../../agent/graph/nodes/planning';
import { GraphState, GraphContext } from '../../../../agent/graph/state';
import { createMockConfig, createMockRunGroup } from '../../../helpers/test-fixtures';

// Mock services
const mockFindClosestFile = vi.fn();
const mockGenerateDetailedPlan = vi.fn();
const mockFormatPlanToMarkdown = vi.fn();

const mockServices = {
    github: {
        findClosestFile: mockFindClosestFile
    },
    analysis: {
        generateDetailedPlan: mockGenerateDetailedPlan,
        formatPlanToMarkdown: mockFormatPlanToMarkdown
    },
    sandbox: {
        toolSemanticCodeSearch: vi.fn().mockResolvedValue([]),
        toolCodeSearch: vi.fn().mockResolvedValue([])
    },
    knowledgeBase: {
        getEnhancedKB: vi.fn()
    },
    orchestration: {
        ToolOrchestrator: vi.fn(),
        AdaptiveModelSelector: vi.fn()
    },
    learning: {
        getStrategyRecommendation: vi.fn().mockResolvedValue({ strategy: 'test' })
    },
    classification: {
        classifyError: vi.fn().mockResolvedValue({ type: 'test', confidence: 0.9 })
    }
} as any;

const mockDbClient = {
    repositoryPreferences: {
        findUnique: vi.fn()
    },
    fixTrajectory: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn()
    }
} as any;

describe('Planning Node Fix Verification', () => {
    let mockContext: GraphContext;
    let baseState: GraphState;

    beforeEach(() => {
        vi.clearAllMocks();
        mockContext = {
            logCallback: vi.fn(),
            services: mockServices,
            dbClient: mockDbClient,
            updateStateCallback: vi.fn()
        } as any;

        baseState = {
            config: createMockConfig(),
            group: { ...createMockRunGroup(), id: 'test-group', runId: 100 },
            currentNode: 'planning',
            iteration: 0,
            maxIterations: 5,
            status: 'working',
            files: {},
            fileReservations: [],
            history: [],
            feedback: [],
            complexityHistory: [],
            solvedNodes: [],
            initialRepoContext: '',
            initialLogText: '',
            currentLogText: ''
        } as any;
    });

    it('should handle "create" action and reserve the file', async () => {
        const createDiagnosis = {
            summary: 'Missing requirements.txt',
            filePath: 'requirements.txt',
            fixAction: 'create',
            confidence: 0.9
        };

        const state: GraphState = {
            ...baseState,
            diagnosis: createDiagnosis as any
        };

        // Mock findClosestFile to return null initially (file doesn't exist)
        mockFindClosestFile.mockResolvedValue(null);
        mockGenerateDetailedPlan.mockResolvedValue({ title: 'Plan', steps: [] });
        mockFormatPlanToMarkdown.mockReturnValue('# Plan');

        const result = await planningNode(state, mockContext);

        expect(result.fileReservations).toContain('requirements.txt');
    });

    it('should correctly propagate DAG node diagnosis', async () => {
        const dagNode = {
            id: 'node-1',
            problem: 'Fix sub-task',
            dependencies: [],
            status: 'pending',
            complexity: 3,
            priority: 1,
            affectedFiles: ['sub-task.ts']
        };

        const errorDAG = {
            nodes: [dagNode],
            edges: []
        };

        const state: GraphState = {
            ...baseState,
            errorDAG: errorDAG as any,
            diagnosis: { // Original top-level diagnosis
                summary: 'Big Error',
                filePath: 'main.ts',
                fixAction: 'edit'
            } as any
        };

        // Mock finding the DAG node's file
        mockFindClosestFile.mockResolvedValue({
            path: 'sub-task.ts',
            file: { name: 'sub-task.ts', content: 'code', language: 'typescript' }
        });
        mockGenerateDetailedPlan.mockResolvedValue({ title: 'Plan', steps: [] });

        const result = await planningNode(state, mockContext);

        // Check that the diagnosis in the result is the DAG node's diagnosis
        expect(result.diagnosis).toBeDefined();
        expect(result.diagnosis?.summary).toBe('Fix sub-task');
        expect(result.diagnosis?.filePath).toBe('sub-task.ts');

        // Check that it reserved the DAG node file, not the top-level file
        expect(result.fileReservations).toContain('sub-task.ts');
    });
});
