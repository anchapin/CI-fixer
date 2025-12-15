import { describe, it, expect } from 'vitest';
import {
    generateEmbedding,
    cosineSimilarity,
    semanticSearch,
    hybridSearch,
    tokenize,
    buildVocabulary
} from '../../../../services/semantic-search/embeddings.js';

describe('Embeddings Service', () => {
    describe('tokenize', () => {
        it('should split text into tokens and filter out short/stop words', () => {
            const text = "The quick brown fox jumps over the lazy dog";
            const tokens = tokenize(text);
            // "the" is stop word, "fox" > 2 chars check
            expect(tokens).toContain('quick');
            expect(tokens).toContain('brown');
            expect(tokens).toContain('jumps');
            expect(tokens).not.toContain('the'); // Stop word
        });

        it('should handle code-like strings', () => {
            const code = "function calculateSum(a, b) { return a + b; }";
            const tokens = tokenize(code);
            expect(tokens).toContain('function');
            expect(tokens).toContain('calculate');
            expect(tokens).toContain('return');
        });
    });

    describe('buildVocabulary', () => {
        it('should build a vocabulary mapping from texts', () => {
            const texts = ["hello world", "hello vitest"];
            const vocab = buildVocabulary(texts);

            // "hello", "world", "vitest" should be in vocab
            // "hello" appears twice but should be one entry
            expect(vocab.has('hello')).toBe(true);
            expect(vocab.has('world')).toBe(true);
            expect(vocab.has('vitest')).toBe(true);
            expect(vocab.get('hello')).toBeDefined();
        });
    });

    describe('generateEmbedding', () => {
        it('should generate a normalized vector', () => {
            const text = "hello world";
            const vocab = new Map([['hello', 0], ['world', 1]]);
            const uniqueTokensInText = 2; // hello, world
            // TF for "hello" = 1/2, "world" = 1/2
            // Vector: [0.5, 0.5]
            // Norm: sqrt(0.25 + 0.25) = sqrt(0.5) = ~0.707
            // Result: [0.5/0.707, 0.5/0.707] = [0.707, 0.707]

            const embedding = generateEmbedding(text, vocab);

            expect(embedding).toHaveLength(2);
            // Verify normalization (magnitude approx 1)
            const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
            expect(magnitude).toBeCloseTo(1, 5);
        });

        it('should handle empty text', () => {
            const embedding = generateEmbedding('', new Map([['test', 0]]));
            expect(embedding).toEqual([0]);
        });
    });

    describe('cosineSimilarity', () => {
        it('should calculate correct similarity', () => {
            const vecA = [1, 0];
            const vecB = [1, 0];
            expect(cosineSimilarity(vecA, vecB)).toBe(1);

            const vecC = [0, 1];
            expect(cosineSimilarity(vecA, vecC)).toBe(0);

            const vecD = [-1, 0];
            expect(cosineSimilarity(vecA, vecD)).toBe(-1);
        });

        it('should throw on dimension mismatch', () => {
            expect(() => cosineSimilarity([1], [1, 2])).toThrow();
        });
    });

    describe('semanticSearch', () => {
        const embeddings = [
            { file: 'file1.ts', embedding: [1, 0, 0], metadata: { language: 'ts', size: 100, lastModified: 0 } },
            { file: 'file2.ts', embedding: [0, 1, 0], metadata: { language: 'ts', size: 100, lastModified: 0 } }, // "similar" to [0,1,0]
            { file: 'file3.ts', embedding: [0, 0, 1], metadata: { language: 'ts', size: 100, lastModified: 0 } },
        ];

        // Mock vocabulary that maps "query" terms to index 1 (matching file2)
        const mockVocab = new Map([['match', 1]]);

        it('should rank files by similarity', () => {
            // Query "match" will generate vector ~[0, 1, 0] (if only token)
            // Should match file2 best
            const results = semanticSearch("match", embeddings, 3, mockVocab);

            expect(results[0].file).toBe('file2.ts');
            expect(results[0].score).toBeGreaterThan(0.9);
        });

        it('should handle empty embeddings/results', () => {
            const results = semanticSearch("test", []);
            expect(results).toEqual([]);
        });
    });

    describe('hybridSearch', () => {
        const embeddings = [
            { file: 'semantic.ts', embedding: [1, 0], metadata: { language: 'ts', size: 10, lastModified: 0 } },
            { file: 'keyword.ts', embedding: [0, 1], metadata: { language: 'ts', size: 10, lastModified: 0 } },
        ];

        // Semantic query matches 'semantic.ts' (index 0)
        const mockVocab = new Map([['semantic', 0]]);

        it('should boost scores for keyword matches', () => {
            // Search for "semantic" -> vector [1, 0]
            // semantic.ts score ~ 1.0 * 0.7 = 0.7
            // keyword.ts score ~ 0.0 * 0.7 = 0.0
            // But if we add keyword match for keyword.ts:
            // keyword.ts: 0.0*0.7 + 0.3*(0.3) = 0.09
            // Wait, logic is: score * weight + boost * (1-weight)
            // Let's rely on the function logic: result.score * semanticWeight + boost * (1 - semanticWeight)

            // Without keyword boost:
            // semantic.ts: 1 * 0.7 = 0.7
            // keyword.ts: 0 * 0.7 = 0

            // With keyword boost for 'keyword.ts':
            // keyword.ts boost: 1 * (1-0.7) = 0.3 (if keywordBoost constant is 1? No, constant is 0.3)
            // Code: const keywordBoost = matches.includes(file) ? 0.3 : 0;
            // Final: score * 0.7 + 0.3 * 0.3 = score*0.7 + 0.09

            // Let's test ordering flip
            // If semantic weight is low, keyword might win?
            // Actually let's just test that the score is modified.

            // The default vocabulary extractor creates 'token_0', 'token_1' etc.
            // matching the embedding dimensions.
            // To trigger a match on the first dimension (semantic.ts), we use 'token_0'.
            const results = hybridSearch("token_0", embeddings, ['keyword.ts'], 2, 0.7);

            // Expected semantic.ts score: high (~1.0) * 0.7 + 0 = 0.7
            // Expected keyword.ts score: low (~0.0) * 0.7 + 0.3 * 0.3 = 0.09

            expect(results[0].file).toBe('semantic.ts'); // Still wins here
            const keywordResult = results.find(r => r.file === 'keyword.ts');
            expect(keywordResult?.score).toBeGreaterThan(0); // Should have some score due to boost
        });
    });
});
