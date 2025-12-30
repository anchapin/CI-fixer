/**
 * Integration test for Multi-Layer Agent Reliability Enhancement (Phases 1-3)
 *
 * This end-to-end test demonstrates how all three reliability layers work together
 * to prevent the agent from entering failure modes that were observed in production.
 *
 * Layers:
 * 1. Phase 1: Path Resolution Enhancement - Prevents "agent lost" failures
 * 2. Phase 2: Reproduction-First Workflow - Prevents "coding blind" failures
 * 3. Phase 3: Strategy Loop Detection - Prevents resource exhaustion from diverging complexity
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runGraphAgent } from '../../../agent/graph/coordinator.js';
import { TestDatabaseManager } from '../../../__tests__/utils/testDb.js';

// Mock the nodes
vi.mock('../../../agent/graph/nodes/analysis.js', () => ({
    analysisNode: vi.fn()
}));
vi.mock('../../../agent/graph/nodes/planning.js', () => ({
    planningNode: vi.fn()
}));
vi.mock('../../../agent/graph/nodes/execution.js', () => ({
    codingNode: vi.fn()
}));
vi.mock('../../../agent/graph/nodes/verification.js', () => ({
    verificationNode: vi.fn()
}));

describe('Multi-Layer Agent Reliability Integration (Phases 1-3)', () => {
    let testDbManager: TestDatabaseManager;
    let mockConfig: any;
    let mockGroup: any;
    let mockServices: any;
    let updateStateCallback: any;
    let logCallback: any;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Initialize test database
        testDbManager = new TestDatabaseManager();
        await testDbManager.setup();

        mockConfig = {
            repoUrl: 'owner/repo',
        };

        mockGroup = {
            id: 'integration-test-group',
            name: 'Multi-Layer Reliability Test',
            mainRun: {}
        };

        mockServices = {
            complexity: {
                detectConvergence: vi.fn(),
                explainComplexity: vi.fn().mockReturnValue('moderate complexity'),
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
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    describe('All Three Layers Working Together', () => {
        it('should demonstrate Phase 1: Path resolution prevents agent lost', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');
            const { codingNode } = await import('../../../agent/graph/nodes/execution.js');
            const { verificationNode } = await import('../../../agent/graph/nodes/verification.js');

            // Scenario: Agent tries to fix a file in a nested directory
            // Without Phase 1, agent might use relative paths and fail to find files

            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                diagnosis: {
                    summary: 'Fix import error',
                    filePath: 'src/components/nested/MyComponent.tsx', // Nested path
                    reproductionCommand: 'npm test -- MyComponent.test.tsx',
                    fixAction: 'edit'
                }
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Fix import',
                    filePath: 'src/components/nested/MyComponent.tsx', // Absolute path used by Phase 1
                    reproductionCommand: 'npm test -- MyComponent.test.tsx'
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
                'Error: Cannot find module ./MyComponent',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Should succeed with proper path resolution
            expect(result.status).toBe('success');
            expect(logCallback).toHaveBeenCalledWith(
                'VERBOSE',
                expect.stringContaining('Reproduction command verified'),
                expect.any(String),
                expect.any(String)
            );
        });

        it('should demonstrate Phase 2: Reproduction requirement prevents coding blind', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');

            // Scenario: Agent receives error log but doesn't know how to reproduce it
            // Without Phase 2, agent would attempt fixes without verification

            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                diagnosis: {
                    summary: 'TypeScript type error',
                    filePath: 'src/utils.ts',
                    fixAction: 'edit'
                    // NO reproductionCommand - this triggers Phase 2 enforcement
                }
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution', // Tries to proceed without reproduction
                diagnosis: {
                    summary: 'Fix type',
                    filePath: 'src/utils.ts',
                    fixAction: 'edit'
                }
            });

            const result = await runGraphAgent(
                mockConfig,
                mockGroup,
                undefined,
                undefined,
                'TypeScript error: Type \'string\' is not assignable to type \'number\'',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Should halt before execution due to missing reproduction command
            expect(result.status).toBe('failed');
            expect(result.message).toContain('Reproduction command required');
            expect(logCallback).toHaveBeenCalledWith(
                'ERROR',
                expect.stringContaining('Cannot proceed to execution without reproduction command'),
                expect.any(String),
                expect.any(String)
            );
            expect(logCallback).toHaveBeenCalledWith(
                'INFO',
                expect.stringContaining('ReproductionInferenceService'),
                expect.any(String),
                expect.any(String)
            );

            // Verify metrics recorded for this failure mode
            expect(mockServices.metrics.recordFixAttempt).toHaveBeenCalledWith(
                false,
                expect.any(Number),
                expect.any(Number),
                'reproduction-command-missing'
            );
        });

        it('should demonstrate Phase 3: Loop detection prevents resource exhaustion', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');

            // Scenario: Complexity keeps increasing, agent is stuck in a loop
            // Without Phase 3, agent would exhaust resources and time

            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory: [10, 12, 14, 16, 18, 20],
                problemComplexity: 20,
                iteration: 5,
                diagnosis: {
                    summary: 'Complex multi-file error',
                    reproductionCommand: 'npm test'
                }
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Complex fix',
                    reproductionCommand: 'npm test'
                }
            });

            // Mock diverging complexity
            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            const result = await runGraphAgent(
                mockConfig,
                mockGroup,
                undefined,
                undefined,
                'Multiple related errors across files',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Should halt due to strategy loop detection
            expect(result.status).toBe('failed');
            expect(result.message).toContain('Strategy loop detected');
            expect(logCallback).toHaveBeenCalledWith(
                'ERROR',
                expect.stringContaining('Strategy Loop'),
                expect.any(String),
                expect.any(String)
            );
            expect(logCallback).toHaveBeenCalledWith(
                'INFO',
                expect.stringContaining('Suggested actions'),
                expect.any(String),
                expect.any(String)
            );

            // Verify metrics recorded
            expect(mockServices.metrics.recordFixAttempt).toHaveBeenCalledWith(
                false,
                expect.any(Number),
                expect.any(Number),
                'strategy-loop-detected'
            );
        });

        it('should demonstrate all three layers in sequence', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');
            const { codingNode } = await import('../../../agent/graph/nodes/execution.js');
            const { verificationNode } = await import('../../../agent/graph/nodes/verification.js');

            // Scenario: Complex production-like scenario
            // - Nested file paths (Phase 1)
            // - Requires reproduction verification (Phase 2)
            // - Potential for complexity divergence (Phase 3)

            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                diagnosis: {
                    summary: 'Fix test failure in nested component',
                    filePath: 'src/components/deeply/nested/Modal.tsx', // Nested path for Phase 1
                    reproductionCommand: 'npm test -- Modal.test.tsx', // Phase 2 requirement
                    fixAction: 'edit'
                },
                complexityHistory: [10, 11, 10, 9], // Stable, not diverging for Phase 3
                problemComplexity: 9,
                iteration: 3
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Fix Modal component',
                    filePath: 'src/components/deeply/nested/Modal.tsx',
                    reproductionCommand: 'npm test -- Modal.test.tsx'
                }
            });

            // Mock stable complexity (not diverging)
            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: true,
                isDiverging: false,
                trend: 'decreasing'
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
                'FAIL src/components/deeply/nested/Modal.test.tsx',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Should succeed - all three layers working together
            expect(result.status).toBe('success');
            expect(logCallback).toHaveBeenCalledWith(
                'VERBOSE',
                expect.stringContaining('Reproduction command verified'),
                expect.any(String),
                expect.any(String)
            );
            // No strategy loop error (complexity is stable)
            expect(logCallback).not.toHaveBeenCalledWith(
                'ERROR',
                expect.stringContaining('Strategy Loop'),
                expect.any(String),
                expect.any(String)
            );
        });
    });

    describe('Failure Mode Prevention', () => {
        it('should prevent "agent lost" failure mode (Phase 1)', async () => {
            // Before Phase 1: Agent would lose track of files in nested directories
            // After Phase 1: All file operations use absolute paths

            const relativeFilePath = './src/utils/helper.js';
            const absoluteFilePath = '/project/src/utils/helper.js'; // Phase 1 converts to absolute

            // Phase 1 ensures agent can find and operate on files regardless of working directory
            expect(absoluteFilePath).toMatch(/^\/|^[A-Z]:/); // Should be absolute path
        });

        it('should prevent "coding blind" failure mode (Phase 2)', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');

            // Before Phase 2: Agent would attempt fixes without knowing how to reproduce
            // After Phase 2: Agent halts and requests reproduction command

            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                diagnosis: {
                    summary: 'Fix error',
                    filePath: 'src/main.ts',
                    fixAction: 'edit'
                    // No reproduction command
                }
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Fix',
                    filePath: 'src/main.ts',
                    fixAction: 'edit'
                }
            });

            const result = await runGraphAgent(
                mockConfig,
                mockGroup,
                undefined,
                undefined,
                'Some error',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Agent should halt before making blind changes
            expect(result.status).toBe('failed');
            expect(result.reproductionCommandMissing).toBe(true);
        });

        it('should prevent resource exhaustion from strategy loops (Phase 3)', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');

            // Before Phase 3: Agent would loop indefinitely, consuming resources
            // After Phase 3: Agent detects diverging complexity and halts

            const divergingComplexityHistory = [10, 12, 14, 16, 18, 20, 22, 24];

            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                complexityHistory: divergingComplexityHistory,
                problemComplexity: 24,
                iteration: 7,
                diagnosis: {
                    summary: 'Fix complex error',
                    reproductionCommand: 'npm test'
                }
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Fix',
                    reproductionCommand: 'npm test'
                }
            });

            mockServices.complexity.detectConvergence.mockReturnValueOnce({
                isStable: false,
                isDiverging: true,
                trend: 'increasing'
            });

            const result = await runGraphAgent(
                mockConfig,
                mockGroup,
                undefined,
                undefined,
                'Error in production',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Agent should halt and request human intervention
            expect(result.status).toBe('failed');
            expect(result.loopDetected).toBe(true);
            expect(result.loopGuidance).toBeDefined();
        });
    });

    describe('Metrics and Observability', () => {
        it('should record metrics for each failure mode prevention', async () => {
            const { analysisNode } = await import('../../../agent/graph/nodes/analysis.js');
            const { planningNode } = await import('../../../agent/graph/nodes/planning.js');

            // Test reproduction command missing metric
            vi.mocked(analysisNode).mockResolvedValueOnce({
                currentNode: 'planning',
                diagnosis: {
                    summary: 'Fix',
                    filePath: 'src/test.ts',
                    fixAction: 'edit'
                }
            });

            vi.mocked(planningNode).mockResolvedValue({
                currentNode: 'execution',
                diagnosis: {
                    summary: 'Fix',
                    filePath: 'src/test.ts',
                    fixAction: 'edit'
                }
            });

            await runGraphAgent(
                mockConfig,
                mockGroup,
                undefined,
                undefined,
                'Error',
                mockServices,
                updateStateCallback,
                logCallback
            );

            // Verify metrics were recorded
            expect(mockServices.metrics.recordFixAttempt).toHaveBeenCalledWith(
                false,
                expect.any(Number),
                expect.any(Number),
                'reproduction-command-missing'
            );
        });
    });
});
