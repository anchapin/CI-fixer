import { describe, it, expect } from 'vitest';
import { estimateComplexity, detectConvergence, isAtomic, explainComplexity } from '../../../services/complexity-estimator.js';
import { GraphState } from '../../../agent/graph/state.js';
import { AppConfig, RunGroup, ErrorCategory } from '../../../types.js';

// Helper to create minimal GraphState for testing
function createTestState(overrides: Partial<GraphState> = {}): GraphState {
    const mockConfig: AppConfig = {
        githubToken: 'test',
        repoUrl: 'https://github.com/test/repo',
        selectedRuns: [],
        devEnv: 'simulation',
        checkEnv: 'simulation'
    };

    const mockGroup: RunGroup = {
        id: 'test-group',
        name: 'Test Group',
        runIds: [123],
        mainRun: {
            id: 123,
            name: 'test',
            path: '.github/workflows/test.yml',
            status: 'completed',
            conclusion: 'failure',
            head_sha: 'abc123',
            html_url: 'https://github.com/test/repo/actions/runs/123'
        }
    };

    return {
        config: mockConfig,
        group: mockGroup,
        activeLog: '',
        currentNode: 'analysis',
        iteration: 0,
        maxIterations: 5,
        status: 'working',
        initialRepoContext: '',
        initialLogText: '',
        currentLogText: '',
        files: {},
        fileReservations: [],
        history: [],
        feedback: [],
        complexityHistory: [],
        solvedNodes: [],
        ...overrides
    };
}

describe('complexity-estimator', () => {
    describe('estimateComplexity', () => {
        it('should return low complexity for simple syntax errors', () => {
            const state = createTestState({
                classification: {
                    category: ErrorCategory.SYNTAX,
                    errorMessage: 'Syntax error',
                    affectedFiles: ['test.ts'],
                    confidence: 0.9,
                    suggestedAction: 'Fix syntax'
                },
                diagnosis: {
                    summary: 'Missing semicolon',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    confidence: 0.9
                },
                fileReservations: ['test.ts'],
                feedback: []
            });

            const complexity = estimateComplexity(state);

            // SYNTAX=1, 1 file=2, no feedback, high confidence
            // Expected: ~2-3
            expect(complexity).toBeLessThan(5);
            expect(complexity).toBeGreaterThan(0);
        });

        it('should return high complexity for dependency errors with low confidence', () => {
            const state = createTestState({
                classification: {
                    category: ErrorCategory.DEPENDENCY,
                    errorMessage: 'Module not found',
                    affectedFiles: ['file1.ts', 'file2.ts', 'file3.ts'],
                    confidence: 0.5,
                    suggestedAction: 'Install dependency'
                },
                diagnosis: {
                    summary: 'Missing dependency',
                    filePath: 'package.json',
                    fixAction: 'edit',
                    confidence: 0.4
                },
                fileReservations: ['file1.ts', 'file2.ts', 'file3.ts'],
                feedback: ['Attempt 1 failed', 'Attempt 2 failed']
            });

            const complexity = estimateComplexity(state);

            // DEPENDENCY=3, 3 files=6, 2 feedback=3, low confidence=~4
            // Expected: ~15+
            expect(complexity).toBeGreaterThan(10);
        });

        it('should return very high complexity for unknown errors', () => {
            const state = createTestState({
                classification: {
                    category: ErrorCategory.UNKNOWN,
                    errorMessage: 'Unknown error',
                    affectedFiles: [],
                    confidence: 0.3,
                    suggestedAction: 'Investigate'
                },
                diagnosis: {
                    summary: 'Unknown error',
                    filePath: '',
                    fixAction: 'edit',
                    confidence: 0.3
                },
                feedback: []
            });

            const complexity = estimateComplexity(state);

            // UNKNOWN=4, low confidence
            expect(complexity).toBeGreaterThan(5);
        });

        it('should increase complexity with iteration count', () => {
            const baseState = createTestState({
                classification: {
                    category: ErrorCategory.SYNTAX,
                    errorMessage: 'Error',
                    affectedFiles: ['test.ts'],
                    confidence: 0.8,
                    suggestedAction: 'Fix'
                },
                iteration: 0
            });

            const laterState = createTestState({
                ...baseState,
                iteration: 3
            });

            const baseComplexity = estimateComplexity(baseState);
            const laterComplexity = estimateComplexity(laterState);

            expect(laterComplexity).toBeGreaterThan(baseComplexity);
        });
    });

    describe('detectConvergence', () => {
        it('should detect unknown trend with insufficient history', () => {
            const result = detectConvergence([5]);

            expect(result.trend).toBe('unknown');
            expect(result.isConverging).toBe(false);
            expect(result.isStable).toBe(false);
            expect(result.isDiverging).toBe(false);
        });

        it('should detect decreasing trend (converging)', () => {
            const result = detectConvergence([10, 8, 6, 4]);

            expect(result.trend).toBe('decreasing');
            expect(result.isConverging).toBe(true);
            expect(result.isDiverging).toBe(false);
        });

        it('should detect increasing trend (diverging)', () => {
            const result = detectConvergence([4, 6, 8, 10]);

            expect(result.trend).toBe('increasing');
            expect(result.isDiverging).toBe(true);
            expect(result.isConverging).toBe(false);
        });

        it('should detect stable trend', () => {
            const result = detectConvergence([5, 5.1, 5.2, 5.1]);

            expect(result.trend).toBe('stable');
            expect(result.isStable).toBe(true);
            expect(result.isConverging).toBe(false);
            expect(result.isDiverging).toBe(false);
        });

        it('should handle mixed trends by looking at recent window', () => {
            // Overall decreasing, but recent stable
            const result = detectConvergence([10, 8, 6, 5, 5.1, 5]);

            expect(result.isStable).toBe(true);
        });
    });

    describe('isAtomic', () => {
        it('should return false for high complexity', () => {
            const result = isAtomic(8, [10, 9, 8]);
            expect(result).toBe(false);
        });

        it('should return false with insufficient history', () => {
            const result = isAtomic(3, [3]);
            expect(result).toBe(false);
        });

        it('should return true for low complexity with stable history', () => {
            const result = isAtomic(3, [5, 4, 3, 3.1, 3]);
            expect(result).toBe(true);
        });

        it('should return false for low complexity but unstable history', () => {
            const result = isAtomic(4, [8, 6, 4]);
            expect(result).toBe(false); // Still decreasing, not stable
        });
    });

    describe('explainComplexity', () => {
        it('should provide human-readable explanation', () => {
            const state = createTestState({
                classification: {
                    category: ErrorCategory.DEPENDENCY,
                    errorMessage: 'Error',
                    affectedFiles: ['file1.ts', 'file2.ts'],
                    confidence: 0.8,
                    suggestedAction: 'Fix'
                },
                fileReservations: ['file1.ts', 'file2.ts'],
                feedback: ['Attempt 1 failed'],
                diagnosis: {
                    summary: 'Test',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    confidence: 0.6
                }
            });

            const complexity = estimateComplexity(state);
            const explanation = explainComplexity(state, complexity);

            expect(explanation).toContain('complexity');
            expect(explanation).toContain('dependency');
            expect(explanation).toContain('2 file(s)');
            expect(explanation).toContain('1 previous attempt');
        });

        it('should classify complexity levels correctly', () => {
            const lowState = createTestState({
                classification: {
                    category: ErrorCategory.SYNTAX,
                    errorMessage: 'Error',
                    affectedFiles: ['test.ts'],
                    confidence: 0.9,
                    suggestedAction: 'Fix'
                }
            });

            const highState = createTestState({
                classification: {
                    category: ErrorCategory.UNKNOWN,
                    errorMessage: 'Error',
                    affectedFiles: ['f1', 'f2', 'f3'],
                    confidence: 0.3,
                    suggestedAction: 'Investigate'
                },
                fileReservations: ['f1', 'f2', 'f3'],
                feedback: ['Failed', 'Failed', 'Failed']
            });

            const lowComplexity = estimateComplexity(lowState);
            const highComplexity = estimateComplexity(highState);

            const lowExplanation = explainComplexity(lowState, lowComplexity);
            const highExplanation = explainComplexity(highState, highComplexity);

            expect(lowExplanation).toContain('Low');
            expect(highExplanation).toMatch(/Medium|High/);
        });
    });
});
