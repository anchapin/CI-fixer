import { describe, it, expect } from 'vitest';
import { rankPatchesByCriteria, getBestPatch, filterViablePatches } from '../../services/repair-agent/patch-ranking.js';
import { PatchCandidate } from '../../services/repair-agent/patch-generation.js';
import { ValidationResult } from '../../services/repair-agent/patch-validation.js';

describe('Patch Ranking', () => {
    const mockPatches: PatchCandidate[] = [
        {
            id: 'patch1',
            code: 'fix1',
            description: 'Direct fix',
            confidence: 0.9,
            strategy: 'direct',
            reasoning: 'test'
        },
        {
            id: 'patch2',
            code: 'fix2',
            description: 'Conservative fix',
            confidence: 0.7,
            strategy: 'conservative',
            reasoning: 'test'
        },
        {
            id: 'patch3',
            code: 'fix3',
            description: 'Alternative fix',
            confidence: 0.8,
            strategy: 'alternative',
            reasoning: 'test'
        }
    ];

    const mockValidationResults = new Map<string, ValidationResult>([
        ['patch1', {
            patchId: 'patch1',
            passed: true,
            testsPassed: true,
            syntaxValid: true,
            staticAnalysisPassed: true,
            executionTime: 1000,
            details: { testsRun: 10, testsFailed: 0, lintErrors: 0, typeErrors: 0 }
        }],
        ['patch2', {
            patchId: 'patch2',
            passed: false,
            testsPassed: false,
            syntaxValid: true,
            staticAnalysisPassed: true,
            executionTime: 2000,
            details: { testsRun: 10, testsFailed: 2, lintErrors: 0, typeErrors: 0 }
        }],
        ['patch3', {
            patchId: 'patch3',
            passed: true,
            testsPassed: true,
            syntaxValid: true,
            staticAnalysisPassed: false,
            executionTime: 1500,
            details: { testsRun: 10, testsFailed: 0, lintErrors: 3, typeErrors: 0 }
        }]
    ]);

    describe('rankPatchesByCriteria', () => {
        it('should rank patches by combined criteria', () => {
            const ranked = rankPatchesByCriteria(mockPatches, mockValidationResults);

            expect(ranked.length).toBe(3);
            expect(ranked[0].rank).toBe(1);
            expect(ranked[1].rank).toBe(2);
            expect(ranked[2].rank).toBe(3);
        });

        it('should prefer patches that passed validation', () => {
            const ranked = rankPatchesByCriteria(mockPatches, mockValidationResults);

            // patch1 passed validation and has high confidence
            expect(ranked[0].patch.id).toBe('patch1');
        });

        it('should include score breakdown', () => {
            const ranked = rankPatchesByCriteria(mockPatches, mockValidationResults);

            expect(ranked[0].breakdown).toHaveProperty('validationScore');
            expect(ranked[0].breakdown).toHaveProperty('confidenceScore');
            expect(ranked[0].breakdown).toHaveProperty('simplicityScore');
            expect(ranked[0].breakdown).toHaveProperty('executionTimeScore');
        });
    });

    describe('getBestPatch', () => {
        it('should return the highest ranked passing patch', () => {
            const ranked = rankPatchesByCriteria(mockPatches, mockValidationResults);
            const best = getBestPatch(ranked);

            expect(best?.id).toBe('patch1');
        });

        it('should return null for empty array', () => {
            const best = getBestPatch([]);
            expect(best).toBeNull();
        });
    });

    describe('filterViablePatches', () => {
        it('should filter patches below minimum score', () => {
            const ranked = rankPatchesByCriteria(mockPatches, mockValidationResults);
            const viable = filterViablePatches(ranked, 0.6);

            expect(viable.length).toBeLessThanOrEqual(ranked.length);
            viable.forEach(rp => {
                expect(rp.score).toBeGreaterThanOrEqual(0.6);
            });
        });
    });
});
