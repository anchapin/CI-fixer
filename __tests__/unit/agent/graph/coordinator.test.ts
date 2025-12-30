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
        // Phase 2: Include reproductionCommand in diagnosis to pass the new requirement check
        vi.mocked(planningNode).mockResolvedValue({
            currentNode: 'execution',
            diagnosis: { reproductionCommand: 'npm test' }
        });
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
        // Phase 2: Include reproductionCommand to pass the requirement check for repair-agent
        vi.mocked(decompositionNode).mockResolvedValueOnce({
            currentNode: 'repair-agent',
            diagnosis: { reproductionCommand: 'npm test' }
        });
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

    describe('Phase 2: Reproduction-First Workflow', () => {
        it('should halt when transitioning to execution without reproduction command', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning'
            });
            // Planning transitions to execution but diagnosis lacks reproductionCommand
            vi.mocked(planningNode).mockResolvedValueOnce({
                currentNode: 'execution',
                diagnosis: { summary: 'Test fix', filePath: 'test.js' } // No reproductionCommand
            });

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
            expect(result.message).toContain('Reproduction command required');
            expect(logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Cannot proceed to execution without reproduction command'), expect.any(String), expect.any(String));
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('ReproductionInferenceService'), expect.any(String), expect.any(String));
        });

        it('should proceed to execution when reproduction command is present', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning'
            });
            // Planning transitions to execution WITH reproductionCommand
            vi.mocked(planningNode).mockResolvedValueOnce({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Test fix',
                    filePath: 'test.js',
                    reproductionCommand: 'npm test'
                }
            });
            vi.mocked(codingNode).mockResolvedValueOnce({
                currentNode: 'verification'
            });
            vi.mocked(verificationNode).mockResolvedValueOnce({
                currentNode: 'finish'
            });

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
            expect(logCallback).toHaveBeenCalledWith('VERBOSE', expect.stringContaining('Reproduction command verified'), expect.any(String), expect.any(String));
        });

        it('should halt repair-agent execution without reproduction command', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning'
            });
            vi.mocked(planningNode).mockResolvedValueOnce({
                currentNode: 'repair-agent',
                diagnosis: { summary: 'Test fix', filePath: 'test.js' } // No reproductionCommand
            });

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
            expect(result.message).toContain('Reproduction command required');
        });

        it('should record metrics when reproduction command is missing', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning'
            });
            vi.mocked(planningNode).mockResolvedValueOnce({
                currentNode: 'execution',
                diagnosis: { summary: 'Test fix' } // No reproductionCommand
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

            expect(mockServices.metrics.recordFixAttempt).toHaveBeenCalledWith(
                false,
                expect.any(Number),
                expect.any(Number),
                'reproduction-command-missing'
            );
        });
    });

    describe('Phase 3: Strategy Loop Detection', () => {
        it('should halt when complexity diverges with high complexity for multiple iterations', async () => {
            // Simulate accumulated complexity over iterations
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                // State accumulates these values across iterations
                complexityHistory: [10, 12, 14, 16, 18],
                problemComplexity: 18,
                iteration: 4 // After 4 iterations
            });

            // Mock complexity service to detect divergence
            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: { reproductionCommand: 'npm test' }
            });
            vi.mocked(codingNode).mockResolvedValue({ currentNode: 'verification' });
            vi.mocked(verificationNode).mockResolvedValue({ currentNode: 'finish' });

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

            // Should log strategy loop detection
            expect(logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Strategy Loop'), expect.any(String), expect.any(String));
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Complexity history'), expect.any(String), expect.any(String));
        });

        it('should warn about divergence but not halt when complexity is below threshold', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory: [5, 7, 9],
                problemComplexity: 9
            });

            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: { reproductionCommand: 'npm test' }
            });
            vi.mocked(codingNode).mockResolvedValue({ currentNode: 'verification' });
            vi.mocked(verificationNode).mockResolvedValue({ currentNode: 'finish' });

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

            // Should succeed (complexity below threshold of 15)
            expect(result.status).toBe('success');
            // Should log a warning about divergence
            expect(logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('Complexity is increasing'), expect.any(String), expect.any(String));
        });

        it('should provide helpful guidance when strategy loop is detected', async () => {
            const complexityHistory = [12, 14, 16, 18, 20];
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory,
                problemComplexity: 20,
                iteration: 4
            });

            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: { reproductionCommand: 'npm test' }
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

            // Verify helpful suggestions are logged
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Suggested actions'), expect.any(String), expect.any(String));
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Break down the problem'), expect.any(String), expect.any(String));
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Try a different approach'), expect.any(String), expect.any(String));
            expect(logCallback).toHaveBeenCalledWith('INFO', expect.stringContaining('Request human guidance'), expect.any(String), expect.any(String));
        });

        it('should record metrics when strategy loop is detected', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory: [14, 16, 18],
                problemComplexity: 18,
                iteration: 2
            });

            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: { reproductionCommand: 'npm test' }
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

            // Should record the strategy loop detection metric
            expect(mockServices.metrics.recordFixAttempt).toHaveBeenCalledWith(
                false,
                expect.any(Number),
                expect.any(Number),
                'strategy-loop-detected'
            );
        });

        it('should not halt when complexity is stable or converging', async () => {
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory: [10, 9, 8],
                problemComplexity: 8
            });

            // Mock converging behavior
            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: true,
                isDiverging: false,
                trend: 'decreasing'
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: { reproductionCommand: 'npm test' }
            });
            vi.mocked(codingNode).mockResolvedValue({ currentNode: 'verification' });
            vi.mocked(verificationNode).mockResolvedValue({ currentNode: 'finish' });

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

            // Should succeed
            expect(result.status).toBe('success');
            // Should NOT log strategy loop error
            expect(logCallback).not.toHaveBeenCalledWith('ERROR', expect.stringContaining('Strategy Loop'), expect.any(String), expect.any(String));
        });

        it('should handle production scenario: complexity diverging above threshold', async () => {
            // Simulate a scenario similar to production failure where complexity keeps increasing
            // Need at least 2 values > 15 in the last 3 entries to trigger the halt
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory: [10, 12, 14, 16, 18, 20],
                problemComplexity: 20,
                iteration: 5 // After 5 iterations
            });

            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: { reproductionCommand: 'npm test' }
            });

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

            // Should halt due to strategy loop
            expect(result.status).toBe('failed');
            expect(result.message).toContain('Strategy loop detected');
            expect(logCallback).toHaveBeenCalledWith('ERROR', expect.stringContaining('Strategy Loop'), expect.any(String), expect.any(String));
        });
    });
});