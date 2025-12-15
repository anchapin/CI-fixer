
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enhanceFixGeneration, selectBestPatch } from '../../services/repair-agent/fix-enhancer';
import { AppConfig } from '../../types';

// Mock dependencies
const mocks = vi.hoisted(() => ({
    generatePatchCandidates: vi.fn(),
    rankPatches: vi.fn(),
    filterByConfidence: vi.fn()
}));

vi.mock('../../services/repair-agent/patch-generation.js', () => ({
    generatePatchCandidates: mocks.generatePatchCandidates,
    rankPatches: mocks.rankPatches,
    filterByConfidence: mocks.filterByConfidence
}));

describe('Fix Enhancer', () => {
    const mockConfig = {} as AppConfig;
    const mockFaultLocation = { file: 'file.ts', line: 1 } as any;
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('enhanceFixGeneration', () => {
        it('should return single strategy if feature is disabled', async () => {
            process.env.ENABLE_MULTI_CANDIDATE_PATCHES = 'false';

            const result = await enhanceFixGeneration(mockConfig, mockFaultLocation, 'original', 'error');

            expect(result).toEqual({
                primaryFix: 'original',
                alternativeFixes: [],
                strategy: 'single'
            });
            expect(mocks.generatePatchCandidates).not.toHaveBeenCalled();
        });

        it('should return single strategy if no viable candidates found', async () => {
            process.env.ENABLE_MULTI_CANDIDATE_PATCHES = 'true';

            mocks.generatePatchCandidates.mockResolvedValue({ candidates: [] });
            mocks.filterByConfidence.mockReturnValue([]);

            const result = await enhanceFixGeneration(mockConfig, mockFaultLocation, 'original', 'error');

            expect(result).toEqual({
                primaryFix: 'original',
                alternativeFixes: [],
                strategy: 'single'
            });
        });

        it('should return multi-candidate strategy with ranked patches', async () => {
            process.env.ENABLE_MULTI_CANDIDATE_PATCHES = 'true';

            const candidates = [
                { id: '1', code: 'fix1', confidence: 0.9 },
                { id: '2', code: 'fix2', confidence: 0.8 },
                { id: '3', code: 'fix3', confidence: 0.7 }
            ];
            mocks.generatePatchCandidates.mockResolvedValue({ candidates, primaryCandidate: candidates[0] });
            mocks.filterByConfidence.mockReturnValue(candidates);
            mocks.rankPatches.mockReturnValue(candidates);

            const result = await enhanceFixGeneration(mockConfig, mockFaultLocation, 'original', 'error');

            expect(result.strategy).toBe('multi-candidate');
            expect(result.primaryFix).toBe('fix1');
            expect(result.alternativeFixes).toEqual(['fix2', 'fix3']);
            expect(result.patchDetails).toBeDefined();
        });

        it('should fallback to single strategy on error', async () => {
            process.env.ENABLE_MULTI_CANDIDATE_PATCHES = 'true';
            mocks.generatePatchCandidates.mockRejectedValue(new Error('Generation failed'));

            const result = await enhanceFixGeneration(mockConfig, mockFaultLocation, 'original', 'error');

            expect(result).toEqual({
                primaryFix: 'original',
                alternativeFixes: [],
                strategy: 'single'
            });
        });
    });

    describe('selectBestPatch', () => {
        it('should return first candidate that passed validation', () => {
            const patchResult = {
                candidates: [
                    { id: '1', code: 'fix1' },
                    { id: '2', code: 'fix2' }
                ],
                primaryCandidate: { id: '1', code: 'fix1' }
            } as any;

            const validationResults = new Map([
                ['1', false],
                ['2', true]
            ]);

            const best = selectBestPatch(patchResult, validationResults);
            expect(best).toBe('fix2');
        });

        it('should fallback to primary candidate if none passed validation', () => {
            const patchResult = {
                candidates: [
                    { id: '1', code: 'fix1' },
                    { id: '2', code: 'fix2' }
                ],
                primaryCandidate: { id: '3', code: 'primary' }
            } as any;

            const validationResults = new Map([
                ['1', false],
                ['2', false]
            ]);

            const best = selectBestPatch(patchResult, validationResults);
            expect(best).toBe('primary');
        });
    });
});
