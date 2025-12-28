
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock dependencies BEFORE importing the module under test using vi.hoisted
const mocks = vi.hoisted(() => ({
    mockIndexFiles: vi.fn(),
    mockSearch: vi.fn(),
    mockGetStatsSearch: vi.fn(),
    mockRetrieveFixPatterns: vi.fn(),
    mockAddPattern: vi.fn(),
    mockGetStatsKB: vi.fn(),
    mockDecideIteration: vi.fn(),
    mockUpdateArm: vi.fn(),
    mockGetStatsThompson: vi.fn(),
    mockCalculateAdaptiveLimit: vi.fn()
}));

vi.mock('../../services/semantic-search/search-service.js', () => {
    return {
        SemanticSearchService: vi.fn(function () {
            return {
                indexFiles: mocks.mockIndexFiles,
                search: mocks.mockSearch,
                getStats: mocks.mockGetStatsSearch
            };
        })
    };
});

vi.mock('../../services/knowledge-base/enhanced-kb.js', () => {
    return {
        EnhancedKnowledgeBase: vi.fn(function () {
            return {
                retrieveFixPatterns: mocks.mockRetrieveFixPatterns,
                addPattern: mocks.mockAddPattern,
                getStats: mocks.mockGetStatsKB
            };
        })
    };
});

vi.mock('../../services/iterative-refinement/thompson-sampling.js', () => {
    return {
        ThompsonSamplingRefiner: vi.fn(function () {
            return {
                decideIteration: mocks.mockDecideIteration,
                updateArm: mocks.mockUpdateArm,
                getStats: mocks.mockGetStatsThompson
            };
        }),
        calculateAdaptiveLimit: mocks.mockCalculateAdaptiveLimit
    };
});

// Import the module under test AFTER mocks
import {
    enhancedFileSearch,
    retrieveFixPatterns,
    recordSuccessfulFix,
    getAdaptiveIterationLimit,
    updateIterationOutcome,
    getEnhancementStats
} from '../../services/enhanced-planning.js';

import { SandboxEnvironment } from '../../sandbox.js';

describe('Enhanced Planning Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('enhancedFileSearch', () => {
        it('should return empty array if sandbox is undefined', async () => {
            const results = await enhancedFileSearch('query', undefined);
            expect(results).toEqual([]);
            expect(mocks.mockIndexFiles).not.toHaveBeenCalled();
        });

        it('should index files if sandbox has files and then search', async () => {
            const mockSandbox = {
                listFiles: vi.fn().mockResolvedValue(new Map([['file1.ts', 'content']]))
            } as unknown as SandboxEnvironment;

            mocks.mockSearch.mockReturnValue([{ file: 'file1.ts', score: 0.9 }]);

            const results = await enhancedFileSearch('query', mockSandbox);

            expect(mockSandbox.listFiles).toHaveBeenCalled();
            expect(mocks.mockIndexFiles).toHaveBeenCalled();
            expect(mocks.mockSearch).toHaveBeenCalledWith('query', 5);
            expect(results).toHaveLength(1);
            expect(results[0].file).toBe('file1.ts');
        });

        it('should handle errors gracefully', async () => {
            const mockSandbox = {
                listFiles: vi.fn().mockRejectedValue(new Error('Sandbox error'))
            } as unknown as SandboxEnvironment;

            const results = await enhancedFileSearch('query', mockSandbox);
            expect(results).toEqual([]);
        });
    });

    describe('retrieveFixPatterns', () => {
        it('should delegate to enhancedKB', () => {
            const mockPattern = { id: '1', score: 0.8 };
            mocks.mockRetrieveFixPatterns.mockReturnValue([mockPattern]);

            const results = retrieveFixPatterns('error', 'TypeError');

            expect(mocks.mockRetrieveFixPatterns).toHaveBeenCalledWith('error', 'TypeError', 'typescript', 3);
            expect(results).toEqual([mockPattern]);
        });

        it('should handle errors gracefully', () => {
            mocks.mockRetrieveFixPatterns.mockImplementation(() => { throw new Error('KB Error'); });
            const results = retrieveFixPatterns('error', 'TypeError');
            expect(results).toEqual([]);
        });
    });

    describe('recordSuccessfulFix', () => {
        it('should add pattern to enhancedKB', () => {
            recordSuccessfulFix('TypeError', 'msg', 'fix', 'ctx');

            expect(mocks.mockAddPattern).toHaveBeenCalledWith(expect.objectContaining({
                errorType: 'TypeError',
                errorMessage: 'msg',
                fixPattern: 'fix',
                context: 'ctx',
                metadata: expect.objectContaining({
                    successRate: 1.0
                })
            }));
        });

        it('should catch errors', () => {
            mocks.mockAddPattern.mockImplementation(() => { throw new Error('Add Error'); });
            expect(() => recordSuccessfulFix('Type', 'msg', 'fix', 'ctx')).not.toThrow();
        });
    });

    describe('getAdaptiveIterationLimit', () => {
        it('should calculate adaptive limit and ask Thompson Refiner', () => {
            mocks.mockCalculateAdaptiveLimit.mockReturnValue(5);
            mocks.mockDecideIteration.mockReturnValue({ shouldIterate: true, reasoning: 'ok' });

            const result = getAdaptiveIterationLimit(3, 8, [true, false], 100);

            // Success rate for [true, false] is 0.5
            expect(mocks.mockCalculateAdaptiveLimit).toHaveBeenCalledWith(3, 8, 0.5, 100);
            expect(mocks.mockDecideIteration).toHaveBeenCalledWith(expect.objectContaining({
                maxIterations: 5,
                successHistory: [true, false]
            }));
            expect(result.limit).toBe(5);
            expect(result.decision).toEqual({ shouldIterate: true, reasoning: 'ok' });
        });

        it('should fallback to base limit on error', () => {
            mocks.mockCalculateAdaptiveLimit.mockImplementation(() => { throw new Error('Calc Error'); });
            const result = getAdaptiveIterationLimit(3, 8, [], 100);
            expect(result.limit).toBe(3);
            expect(result.decision).toBeNull();
        });
    });

    describe('updateIterationOutcome', () => {
        it('should update arm with success', () => {
            updateIterationOutcome(true);
            expect(mocks.mockUpdateArm).toHaveBeenCalledWith('continue', true);
        });

        it('should update arm with failure', () => {
            updateIterationOutcome(false);
            expect(mocks.mockUpdateArm).toHaveBeenCalledWith('terminate', false); // Based on code logic: success?continue:terminate
        });
    });

    describe('getEnhancementStats', () => {
        it('should aggregate stats', () => {
            mocks.mockGetStatsSearch.mockReturnValue({ files: 1 });
            mocks.mockGetStatsKB.mockReturnValue({ patterns: 2 });
            mocks.mockGetStatsThompson.mockReturnValue({ arms: 3 });

            const stats = getEnhancementStats();

            expect(stats.semanticSearch).toEqual({ files: 1 });
            expect(stats.enhancedKB).toEqual({ patterns: 2 });
            expect(stats.thompsonSampling).toEqual({ arms: 3 });
        });
    });

});
