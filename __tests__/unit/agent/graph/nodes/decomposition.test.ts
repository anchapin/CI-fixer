
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { decompositionNode } from '../../../../../agent/graph/nodes/decomposition.js';

describe('Decomposition Node', () => {
    let mockState: any;
    let mockContext: any;
    let mockServices: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockServices = {
            llm: {
                unifiedGenerate: vi.fn(),
                safeJsonParse: vi.fn(),
            },
        };

        mockContext = {
            logCallback: vi.fn(),
            services: mockServices,
        };

        mockState = {
            config: {},
            diagnosis: { summary: 'Complex error' },
            classification: { category: 'logic', affectedFiles: ['file.ts'] },
            problemComplexity: 9,
            feedback: [],
        };
    });

    it('should skip decomposition if complexity is low', async () => {
        mockState.problemComplexity = 5;
        const result = await decompositionNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(mockServices.llm.unifiedGenerate).not.toHaveBeenCalled();
    });

    it('should generate DAG for high complexity errors', async () => {
        mockServices.llm.unifiedGenerate.mockResolvedValue({ text: '{"shouldDecompose": true, "nodes": [], "edges": []}' });
        mockServices.llm.safeJsonParse.mockReturnValue({
            shouldDecompose: true,
            nodes: [{ id: 'node1', problem: 'subproblem' }],
            edges: []
        });

        const result = await decompositionNode(mockState, mockContext);

        expect(mockServices.llm.unifiedGenerate).toHaveBeenCalled();
        expect(result.errorDAG).toBeDefined();
        expect(result.currentNode).toBe('planning');
    });

    it('should handle LLM decision not to decompose', async () => {
        mockServices.llm.safeJsonParse.mockReturnValue({
            shouldDecompose: false,
            reasoning: 'Too simple'
        });

        const result = await decompositionNode(mockState, mockContext);

        expect(result.currentNode).toBe('planning');
        expect(result.errorDAG).toBeUndefined();
    });
});
