
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
                unifiedGenerate: vi.fn().mockResolvedValue({ text: '{}' }),
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

    it('should handle invalid DAG (empty nodes)', async () => {
        mockServices.llm.safeJsonParse.mockReturnValue({
            shouldDecompose: true,
            nodes: [],
            edges: []
        });

        const result = await decompositionNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(mockContext.logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('No nodes'));
    });

    it('should handle invalid DAG (duplicate node IDs)', async () => {
        mockServices.llm.safeJsonParse.mockReturnValue({
            shouldDecompose: true,
            nodes: [{ id: 'node1' }, { id: 'node1' }],
            edges: []
        });

        const result = await decompositionNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(mockContext.logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Duplicate node ID'));
    });

    it('should handle invalid DAG (non-existent edge ref)', async () => {
        mockServices.llm.safeJsonParse.mockReturnValue({
            shouldDecompose: true,
            nodes: [{ id: 'node1' }],
            edges: [{ from: 'node1', to: 'node2' }]
        });

        const result = await decompositionNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(mockContext.logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('non-existent node'));
    });

    it('should handle DAG with cycles', async () => {
        mockServices.llm.safeJsonParse.mockReturnValue({
            shouldDecompose: true,
            nodes: [{ id: 'node1' }, { id: 'node2' }],
            edges: [{ from: 'node1', to: 'node2' }, { from: 'node2', to: 'node1' }]
        });

        const result = await decompositionNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(mockContext.logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('contains cycles'));
    });

    it('should handle LLM generation errors', async () => {
        mockServices.llm.unifiedGenerate.mockRejectedValue(new Error('LLM down'));

        const result = await decompositionNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(mockContext.logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Failed to generate DAG'));
    });
});
