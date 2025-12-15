import { describe, it, expect, beforeEach } from 'vitest';
import { generateEmbedding, cosineSimilarity, semanticSearch, buildVocabulary } from '../../services/semantic-search/embeddings.js';
import { SemanticSearchService } from '../../services/semantic-search/search-service.js';

describe('Semantic Code Search', () => {
    describe('Embeddings', () => {
        it('should generate embeddings for text', () => {
            const text = 'function processData() { return result; }';
            const embedding = generateEmbedding(text);

            expect(embedding).toBeDefined();
            expect(embedding.length).toBeGreaterThan(0);
            expect(embedding.every(v => typeof v === 'number')).toBe(true);
        });

        it('should generate normalized embeddings', () => {
            const text = 'const x = 42;';
            const embedding = generateEmbedding(text);

            // Check if normalized (magnitude should be ~1)
            const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
            expect(magnitude).toBeCloseTo(1.0, 1);
        });

        it('should calculate cosine similarity', () => {
            const text1 = 'function add(a, b) { return a + b; }';
            const text2 = 'function subtract(a, b) { return a - b; }';
            const text3 = 'const API_KEY = "secret";';

            // Use shared vocab for meaningful comparison
            const vocab = buildVocabulary([text1, text2, text3]);

            const emb1 = generateEmbedding(text1, vocab);
            const emb2 = generateEmbedding(text2, vocab);
            const emb3 = generateEmbedding(text3, vocab);

            const sim12 = cosineSimilarity(emb1, emb2);
            const sim13 = cosineSimilarity(emb1, emb3);

            // Similar functions should have higher similarity than unrelated code
            expect(sim12).toBeGreaterThan(sim13);
        });
    });

    describe('Semantic Search', () => {
        it('should find similar code', () => {
            const codeSnippets = [
                'function add(a, b) { return a + b; }', // math function
                'const API_KEY = "secret";',             // API configuration
                'function multiply(x, y) { return x * y; }' // math function
            ];

            // Build shared vocabulary including query terms
            const corpus = [...codeSnippets, 'function that adds numbers'];
            const vocabulary = buildVocabulary(corpus);

            const codeEmbeddings = [
                {
                    file: 'math.ts',
                    embedding: generateEmbedding(codeSnippets[0], vocabulary),
                    metadata: { language: 'typescript', size: 100, lastModified: Date.now() }
                },
                {
                    file: 'api.ts',
                    embedding: generateEmbedding(codeSnippets[1], vocabulary),
                    metadata: { language: 'typescript', size: 50, lastModified: Date.now() }
                },
                {
                    file: 'calc.ts',
                    embedding: generateEmbedding(codeSnippets[2], vocabulary),
                    metadata: { language: 'typescript', size: 120, lastModified: Date.now() }
                }
            ];

            const results = semanticSearch('function add', codeEmbeddings, 2, vocabulary);

            expect(results.length).toBe(2);
            expect(results[0].score).toBeGreaterThan(0);
            // Math-related files should rank higher
            expect(['math.ts', 'calc.ts']).toContain(results[0].file);
        });
    });

    describe('SemanticSearchService', () => {
        let service: SemanticSearchService;

        beforeEach(() => {
            service = new SemanticSearchService();
        });

        it('should index files', async () => {
            const files = new Map([
                ['user.ts', 'class User { getName() { return this.name; } }'],
                ['auth.ts', 'function authenticate(token) { return verify(token); }']
            ]);

            await service.indexFiles(files);

            const stats = service.getStats();
            expect(stats.indexedFiles).toBe(2);
            expect(stats.vocabularySize).toBeGreaterThan(0);
        });

        it('should search indexed files', async () => {
            const files = new Map([
                ['user.ts', 'class User { getName() { return this.name; } }'],
                ['product.ts', 'class Product { getPrice() { return this.price; } }'],
                ['auth.ts', 'function authenticate(token) { return verify(token); }']
            ]);

            await service.indexFiles(files);

            const results = service.search('user authentication', 2);

            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].file).toBeDefined();
        });
    });
});
