import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGraphAgent } from '../../../../agent/graph/coordinator.js';
import { AgentPhase } from '../../../../types.js';

// Nodes
import { analysisNode } from '../../../../agent/graph/nodes/analysis.js';
import { decompositionNode } from '../../../../agent/graph/nodes/decomposition.js';
import { planningNode } from '../../../../agent/graph/nodes/planning.js';
import { codingNode } from '../../../../agent/graph/nodes/execution.js';
import { verificationNode } from '../../../../agent/graph/nodes/verification.js';
import { repairAgentNode } from '../../../../agent/graph/nodes/repair-agent.js';

// Mocks for nodes
vi.mock('../../../../agent/graph/nodes/analysis.js', () => ({
    analysisNode: vi.fn()
}));
vi.mock('../../../../agent/graph/nodes/decomposition.js', () => ({
    decompositionNode: vi.fn()
}));
vi.mock('../../../../agent/graph/nodes/planning.js', () => ({
    planningNode: vi.fn()
}));
vi.mock('../../../../agent/graph/nodes/execution.js', () => ({
    codingNode: vi.fn()
}));
vi.mock('../../../../agent/graph/nodes/verification.js', () => ({
    verificationNode: vi.fn()
}));
vi.mock('../../../../agent/graph/nodes/repair-agent.js', () => ({
    repairAgentNode: vi.fn()
}));

describe('Graph Coordinator', () => {
    let mockConfig: any;
    let mockGroup: any;
    let mockServices: any;
    let updateStateCallback: any;
    let logCallback: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockConfig = {
            repoUrl: 'owner/repo',
        };

        mockGroup = {
            id: 'group-1',
            name: 'Test Group',
            mainRun: {}
        };

        mockServices = {
            complexity: {
                detectConvergence: vi.fn().mockReturnValue({ isStable: true, isDiverging: false }),
                explainComplexity: vi.fn().mockReturnValue('low complexity'),
            },
            metrics: {
                recordFixAttempt: vi.fn(),
            },
            learningMetrics: {
                recordMetric: vi.fn().mockResolvedValue(undefined),
            },
            ingestion: {
                ingestRawData: vi.fn().mockResolvedValue(undefined),
            }
        };

        updateStateCallback = vi.fn();
        logCallback = vi.fn();

        // Default successful transitions (except analysis which is the starting node)
        vi.mocked(planningNode).mockResolvedValue({ currentNode: 'execution' });
        vi.mocked(codingNode).mockResolvedValue({ currentNode: 'verification' });
        vi.mocked(verificationNode).mockResolvedValue({ currentNode: 'finish' });
    });

    it('should transition through nodes successfully', async () => {
        vi.mocked(analysisNode).mockResolvedValue({ currentNode: 'planning' });
        const result = await runGraphAgent(
            mockConfig,
            mockGroup,
            undefined,
            undefined,
            'Initial context',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('success');
        expect(updateStateCallback).toHaveBeenCalled();
        expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Finished'), expect.any(String), expect.any(String));
    });

    it('should cover decomposition and repair-agent node switch cases', async () => {
        vi.mocked(analysisNode).mockResolvedValueOnce({ currentNode: 'decomposition' });
        vi.mocked(decompositionNode).mockResolvedValueOnce({ currentNode: 'repair-agent' });
        vi.mocked(repairAgentNode).mockResolvedValueOnce({ currentNode: 'finish' });

        await runGraphAgent(
            mockConfig,
            mockGroup,
            undefined,
            undefined,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        );
        
        expect(decompositionNode).toHaveBeenCalled();
        expect(repairAgentNode).toHaveBeenCalled();
    });

    it('should handle early finish from analysis', async () => {
        vi.mocked(analysisNode).mockResolvedValueOnce({ currentNode: 'finish' });

        const result = await runGraphAgent(
            mockConfig,
            mockGroup,
            undefined,
            undefined,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('success');
    });

    it('should detect divergence and log it', async () => {
        mockServices.complexity.detectConvergence.mockReturnValueOnce({ isStable: false, isDiverging: true });
        
        vi.mocked(analysisNode)
            .mockResolvedValueOnce({ 
                currentNode: 'analysis', 
                complexityHistory: [1, 2, 3],
                iteration: 4 // Trigger loop end via iteration count
            })
            .mockResolvedValueOnce({
                currentNode: 'finish'
            });

        await runGraphAgent(
            mockConfig,
            mockGroup,
            undefined,
            undefined,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        );

        // Check if logCallback was called with the WARN message
        expect(logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('Complexity is increasing'), expect.any(String), expect.any(String));
    });

    it('should handle stopped status', async () => {
        vi.mocked(analysisNode).mockResolvedValueOnce({ status: 'stopped' as any, currentNode: 'finish' });

        const result = await runGraphAgent(
            mockConfig,
            mockGroup,
            undefined,
            undefined,
            '',
            mockServices,
            updateStateCallback,
            logCallback
        );

        expect(result.status).toBe('failed');
    });
});