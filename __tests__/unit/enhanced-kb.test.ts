import { describe, it, expect, beforeEach } from 'vitest';
import { EnhancedKnowledgeBase, ErrorPattern } from '../../services/knowledge-base/enhanced-kb.js';

describe('Enhanced Knowledge Base', () => {
    let kb: EnhancedKnowledgeBase;

    beforeEach(() => {
        kb = new EnhancedKnowledgeBase();
    });

    const createPattern = (id: string, errorType: string, message: string): ErrorPattern => ({
        id,
        errorType,
        errorMessage: message,
        context: `Context for ${message}`,
        fixPattern: `Fix for ${message}`,
        metadata: {
            language: 'typescript',
            frequency: 1,
            successRate: 0.8,
            lastUsed: Date.now()
        }
    });

    describe('Pattern Management', () => {
        it('should add and retrieve patterns', () => {
            const pattern = createPattern('1', 'TypeError', 'Cannot read property of undefined');
            kb.addPattern(pattern);

            const stats = kb.getStats();
            expect(stats.totalPatterns).toBe(1);
            expect(stats.errorTypes).toBe(1);
        });

        it('should index patterns by error type and language', () => {
            kb.addPattern(createPattern('1', 'TypeError', 'Null reference'));
            kb.addPattern(createPattern('2', 'TypeError', 'Undefined property'));
            kb.addPattern(createPattern('3', 'SyntaxError', 'Missing semicolon'));

            const stats = kb.getStats();
            expect(stats.totalPatterns).toBe(3);
            expect(stats.errorTypes).toBe(2);
        });
    });

    describe('Fix Retrieval', () => {
        beforeEach(() => {
            kb.addPattern(createPattern('1', 'TypeError', 'Cannot read property name of undefined'));
            kb.addPattern(createPattern('2', 'TypeError', 'Cannot read property value of null'));
            kb.addPattern(createPattern('3', 'SyntaxError', 'Unexpected token'));
        });

        it('should retrieve relevant patterns', () => {
            const results = kb.retrieveFixPatterns(
                'Cannot read property name of undefined',
                'TypeError',
                'typescript',
                2
            );

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].score).toBeGreaterThan(0);
            expect(results[0].pattern.errorType).toBe('TypeError');
        });

        it('should rank by similarity', () => {
            const results = kb.retrieveFixPatterns(
                'Cannot read property name',
                'TypeError',
                'typescript',
                2
            );

            expect(results.length).toBe(2);
            // First result should have higher score
            expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
        });

        it('should return empty for no matches', () => {
            const results = kb.retrieveFixPatterns(
                'Unknown error',
                'UnknownError',
                'python', // Different language - no fallback possible
                2
            );

            expect(results.length).toBe(0);
        });
    });

    describe('Learning', () => {
        it('should update success rate on success', () => {
            const pattern = createPattern('1', 'TypeError', 'Test error');
            kb.addPattern(pattern);

            const initialRate = pattern.metadata.successRate;
            kb.recordSuccess('1');

            const stats = kb.getStats();
            expect(stats.avgSuccessRate).toBeGreaterThan(initialRate);
        });

        it('should update success rate on failure', () => {
            const pattern = createPattern('1', 'TypeError', 'Test error');
            kb.addPattern(pattern);

            const initialRate = pattern.metadata.successRate;
            kb.recordFailure('1');

            const stats = kb.getStats();
            expect(stats.avgSuccessRate).toBeLessThan(initialRate);
        });

        it('should track frequency', () => {
            const pattern = createPattern('1', 'TypeError', 'Test error');
            kb.addPattern(pattern);

            kb.recordSuccess('1');
            kb.recordSuccess('1');

            expect(pattern.metadata.frequency).toBe(3); // 1 initial + 2 successes
        });
    });
});
