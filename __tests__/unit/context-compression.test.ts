import { describe, it, expect } from 'vitest';
import { scoreTokens } from '../../services/context-compression/token-scorer.js';
import { compressContext, adaptiveCompress } from '../../services/context-compression/compressor.js';

describe('Context Compression', () => {
    describe('Token Scoring', () => {
        it('should score error keywords highly', () => {
            const text = 'Error: Cannot find module at line 42';
            const scores = scoreTokens(text);

            const errorToken = scores.find(s => s.token.toLowerCase().includes('error'));
            expect(errorToken).toBeDefined();
            expect(errorToken!.importance).toBeGreaterThan(0.3);
            expect(errorToken!.category).toBe('error');
        });

        it('should score code tokens appropriately', () => {
            const text = 'Error in processData function at server.ts';
            const scores = scoreTokens(text);

            // processData should be identified as code
            const codeTokens = scores.filter(s => s.category === 'code');
            expect(codeTokens.length).toBeGreaterThan(0);
        });

        it('should apply recency bias', () => {
            const text = 'old token ... ... ... recent token';
            const scores = scoreTokens(text);

            const oldScore = scores[0].importance;
            const recentScore = scores[scores.length - 1].importance;

            // Recent tokens should have higher recency component
            expect(recentScore).toBeGreaterThanOrEqual(oldScore);
        });
    });

    describe('Compression', () => {
        it('should achieve target compression ratio', () => {
            const text = 'Error at line 10 in file.ts. Cannot read property name of undefined. Stack trace shows processUser called getUserData which returned null.';
            const result = compressContext(text, { targetRatio: 3.0, minImportanceThreshold: 0.2, preserveStructure: true });

            expect(result.compressionRatio).toBeGreaterThanOrEqual(2.5);
            expect(result.compressionRatio).toBeLessThanOrEqual(3.5);
        });

        it('should retain high-importance information', () => {
            const text = 'Error: Cannot find module at server.ts line 10';
            const result = compressContext(text, { targetRatio: 2.0, minImportanceThreshold: 0.2, preserveStructure: true });

            const lower = result.compressed.toLowerCase();
            expect(lower).toContain('error');
            // Should retain some important tokens
            expect(result.retainedImportance).toBeGreaterThan(0.5);
        });

        it('should handle empty text', () => {
            const result = compressContext('', { targetRatio: 6.0, minImportanceThreshold: 0.3, preserveStructure: true });

            expect(result.compressed).toBe('');
            expect(result.compressionRatio).toBe(1.0);
        });

        it('should preserve structure when enabled', () => {
            const text = 'First sentence. Second sentence. Third sentence.';
            const result = compressContext(text, { targetRatio: 2.0, minImportanceThreshold: 0.1, preserveStructure: true });

            expect(result.compressed).toContain('.');
        });
    });

    describe('Adaptive Compression', () => {
        it('should not compress if under limit', () => {
            const text = 'Short text';
            const result = adaptiveCompress(text, 1000);

            expect(result.compressed).toBe(text);
            expect(result.compressionRatio).toBe(1.0);
        });

        it('should compress if over limit', () => {
            const longText = 'word '.repeat(1000);
            const result = adaptiveCompress(longText, 100);

            expect(result.compressedLength).toBeLessThan(result.originalLength);
            expect(result.compressionRatio).toBeGreaterThan(1.0);
        });
    });
});
