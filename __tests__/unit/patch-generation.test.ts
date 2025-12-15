import { describe, it, expect } from 'vitest';
import { rankPatches, filterByConfidence, PatchCandidate } from '../../services/repair-agent/patch-generation.js';

describe('Patch Generation', () => {
    describe('rankPatches', () => {
        it('should rank patches by confidence', () => {
            const candidates: PatchCandidate[] = [
                {
                    id: '1',
                    code: 'fix1',
                    description: 'Low confidence',
                    confidence: 0.5,
                    strategy: 'direct',
                    reasoning: 'test'
                },
                {
                    id: '2',
                    code: 'fix2',
                    description: 'High confidence',
                    confidence: 0.9,
                    strategy: 'direct',
                    reasoning: 'test'
                },
                {
                    id: '3',
                    code: 'fix3',
                    description: 'Medium confidence',
                    confidence: 0.7,
                    strategy: 'conservative',
                    reasoning: 'test'
                }
            ];

            const ranked = rankPatches(candidates);

            expect(ranked[0].confidence).toBe(0.9);
            expect(ranked[1].confidence).toBe(0.7);
            expect(ranked[2].confidence).toBe(0.5);
        });

        it('should prefer direct fixes when confidence is similar', () => {
            const candidates: PatchCandidate[] = [
                {
                    id: '1',
                    code: 'fix1',
                    description: 'Alternative',
                    confidence: 0.8,
                    strategy: 'alternative',
                    reasoning: 'test'
                },
                {
                    id: '2',
                    code: 'fix2',
                    description: 'Direct',
                    confidence: 0.8,
                    strategy: 'direct',
                    reasoning: 'test'
                }
            ];

            const ranked = rankPatches(candidates);

            expect(ranked[0].strategy).toBe('direct');
        });
    });

    describe('filterByConfidence', () => {
        it('should filter patches below threshold', () => {
            const candidates: PatchCandidate[] = [
                {
                    id: '1',
                    code: 'fix1',
                    description: 'Low',
                    confidence: 0.3,
                    strategy: 'direct',
                    reasoning: 'test'
                },
                {
                    id: '2',
                    code: 'fix2',
                    description: 'High',
                    confidence: 0.8,
                    strategy: 'direct',
                    reasoning: 'test'
                }
            ];

            const filtered = filterByConfidence(candidates, 0.5);

            expect(filtered.length).toBe(1);
            expect(filtered[0].confidence).toBe(0.8);
        });
    });
});
