import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analysisNode } from '../../agent/graph/nodes/analysis.js';
import { GraphState, GraphContext } from '../../agent/graph/state.js';
import { LoopDetector } from '../../services/LoopDetector.js';
import { AgentPhase } from '../../types.js';

describe('Strategy Shift Mitigation', () => {
    let mockState: any;
    let mockContext: any;
    let loopDetector: LoopDetector;

    beforeEach(() => {
        loopDetector = new LoopDetector();
        
        mockState = {
            config: {},
            group: { id: 'G1', name: 'Group 1', runIds: ['R1'], mainRun: {} },
            iteration: 1,
            maxIterations: 5,
            status: 'working',
            activeLog: '',
            files: {},
            feedback: [],
            complexityHistory: [],
            currentLogText: 'Error: Path NOT FOUND'
        };

        mockContext = {
            logCallback: vi.fn(),
            sandbox: {
                runCommand: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
                getWorkDir: () => '/work'
            },
            services: {
                loopDetector,
                github: { getWorkflowLogs: vi.fn() },
                context: { smartThinLog: vi.fn(l => l) },
                classification: { 
                    classifyErrorWithHistory: vi.fn().mockResolvedValue({ category: 'runtime', errorMessage: 'err' }),
                    getErrorPriority: vi.fn().mockReturnValue(3)
                },
                analysis: {
                    generateRepoSummary: vi.fn().mockResolvedValue('summary'),
                    diagnoseError: vi.fn().mockResolvedValue({ summary: 'diag', fixAction: 'edit' }),
                    refineProblemStatement: vi.fn().mockResolvedValue('refined statement')
                },
                complexity: {
                    estimateComplexity: vi.fn().mockReturnValue(5),
                    detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                    isAtomic: vi.fn().mockReturnValue(false),
                    explainComplexity: vi.fn().mockReturnValue('low')
                }
            }
        };
    });

    it('should inject Strategy Shift warning after 2 hallucinations', async () => {
        const hallucinatedPath = 'missing.ts';
        
        // Record 2 hallucinations
        loopDetector.recordHallucination(hallucinatedPath);
        loopDetector.recordHallucination(hallucinatedPath);

        await analysisNode(mockState, mockContext);

        // Verify diagnoseError was called with the warning in logSnippet
        expect(mockContext.services.analysis.diagnoseError).toHaveBeenCalledWith(
            expect.any(Object),
            expect.stringContaining('STRATEGY SHIFT REQUIRED'),
            expect.any(String),
            undefined,
            expect.any(Object),
            expect.any(Array)
        );

        // Verify feedback was updated
        expect(mockState.feedback).toEqual(
            expect.arrayContaining([expect.stringContaining('STRATEGY SHIFT REQUIRED')])
        );
    });
});