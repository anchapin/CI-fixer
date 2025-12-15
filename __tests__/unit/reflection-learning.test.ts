import { describe, it, expect, beforeEach } from 'vitest';
import { ReflectionLearningSystem } from '../../services/reflection/learning-system.js';

describe('Reflection & Learning', () => {
    let system: ReflectionLearningSystem;

    beforeEach(() => {
        system = new ReflectionLearningSystem();
    });

    describe('Failure Recording', () => {
        it('should record failures', () => {
            system.recordFailure(
                'TypeError',
                'Null reference',
                'Added null check',
                'user.ts:42'
            );

            const stats = system.getStats();
            expect(stats.totalFailurePatterns).toBe(1);
        });

        it('should track failure frequency', () => {
            system.recordFailure('TypeError', 'Null reference', 'Fix 1', 'ctx1');
            system.recordFailure('TypeError', 'Null reference', 'Fix 2', 'ctx2');
            system.recordFailure('TypeError', 'Null reference', 'Fix 3', 'ctx3');

            const stats = system.getStats();
            expect(stats.mostCommonFailure).toBe('Null reference');
        });
    });

    describe('Success Recording', () => {
        it('should record successes', () => {
            system.recordSuccess(
                'TypeError',
                'Added null check before access',
                'user.ts:42'
            );

            const stats = system.getStats();
            expect(stats.totalSuccessPatterns).toBe(1);
        });
    });

    describe('Reflection', () => {
        it('should generate insights from patterns', () => {
            // Record multiple failures
            for (let i = 0; i < 5; i++) {
                system.recordFailure(
                    'TypeError',
                    'Null reference',
                    `Attempt ${i}`,
                    'context'
                );
            }

            const result = system.reflect();

            expect(result.insights.length).toBeGreaterThan(0);
            expect(result.patternsIdentified).toBeGreaterThan(0);
        });

        it('should provide improvement suggestions', () => {
            // Record frequent failures
            for (let i = 0; i < 6; i++) {
                system.recordFailure(
                    'SyntaxError',
                    'Missing semicolon',
                    'Added semicolon',
                    'file.ts'
                );
            }

            const result = system.reflect();

            expect(result.improvementSuggestions.length).toBeGreaterThan(0);
        });

        it('should detect high failure rate', () => {
            // Record more failures than successes
            for (let i = 0; i < 5; i++) {
                system.recordFailure('Error', `Reason ${i}`, 'Fix', 'ctx');
            }
            system.recordSuccess('Error', 'Fix', 'ctx');

            const result = system.reflect();

            expect(result.improvementSuggestions.some(s =>
                s.includes('failure rate')
            )).toBe(true);
        });
    });

    describe('Learning Extraction', () => {
        it('should extract learnings from iterations', () => {
            const iterations = [
                { success: true, errorType: 'TypeError', approach: 'null check', feedback: 'ok' },
                { success: false, errorType: 'TypeError', approach: 'type cast', feedback: 'failed' },
                { success: false, errorType: 'TypeError', approach: 'type cast', feedback: 'failed' }
            ];

            const learnings = system.extractLearnings(iterations);

            expect(learnings.length).toBeGreaterThan(0);
            expect(learnings.some(l => l.includes('successful'))).toBe(true);
        });

        it('should identify failing approaches', () => {
            const iterations = [
                { success: false, errorType: 'Error', approach: 'bad approach', feedback: 'f1' },
                { success: false, errorType: 'Error', approach: 'bad approach', feedback: 'f2' },
                { success: false, errorType: 'Error', approach: 'bad approach', feedback: 'f3' }
            ];

            const learnings = system.extractLearnings(iterations);

            expect(learnings.some(l => l.includes('Avoid'))).toBe(true);
        });
    });

    describe('Statistics', () => {
        it('should calculate failure rate', () => {
            system.recordFailure('E1', 'R1', 'F1', 'C1');
            system.recordFailure('E2', 'R2', 'F2', 'C2');
            system.recordSuccess('E3', 'F3', 'C3');

            const stats = system.getStats();

            expect(stats.failureRate).toBeCloseTo(0.67, 1);
        });
    });
});
