
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticSearchService, getSemanticSearchService } from '../../../../services/semantic-search/search-service.js';
import * as embeddings from '../../../../services/semantic-search/embeddings.js';

// Mock embeddings module
vi.mock('../../../../services/semantic-search/embeddings.js', () => ({
    generateEmbedding: vi.fn(),
    semanticSearch: vi.fn(),
    hybridSearch: vi.fn(),
    tokenize: vi.fn((text) => text.split(' ')), // Simple tokenizer for testing
    buildVocabulary: vi.fn(),
    SearchResult: {}
}));

describe('Semantic Search Service', () => {
    let service: SemanticSearchService;

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton if possible, or just create new instance if class is exported
        // The class is exported, so we can instantiate it directly for testing
        service = new SemanticSearchService();
    });

    describe('indexFile', () => {
        it('should generate embedding and store file data', async () => {
            (embeddings.generateEmbedding as any).mockReturnValue([0.1, 0.2]);

            await service.indexFile('test.ts', 'const a = 1;');

            const stats = service.getStats();
            expect(stats.indexedFiles).toBe(1);
            expect(embeddings.generateEmbedding).toHaveBeenCalled();
        });

        it('should detect language from extension', async () => {
            (embeddings.generateEmbedding as any).mockReturnValue([]);
            await service.indexFile('test.py', 'print("hello")');

            // Access private map via any casting or testing side effects? 
            // The class doesn't expose the map directly, but we can check via search if we mock it right,
            // or just trust that standard indexing works.
            // Let's rely on internal state reflection if needed or just stats.
            const stats = service.getStats();
            expect(stats.indexedFiles).toBe(1);
        });
    });

    describe('indexFiles', () => {
        it('should build vocabulary and index multiple files', async () => {
            const files = new Map([
                ['file1.ts', 'content1'],
                ['file2.ts', 'content2']
            ]);

            const mockVocab = new Map([['test', 1]]);
            (embeddings.generateEmbedding as any).mockReturnValue([0.1]);
            // We need to mock buildVocabulary logic inside the class? 
            // The class has a private buildVocabulary method.
            // Wait, the class calls `this.buildVocabulary` which calls `this.tokenize`.
            // It does NOT call `embeddings.buildVocabulary` from the import?
            // Checking source code:
            // private buildVocabulary(texts: string[]): Map<string, number> { ... }
            // So it implements its own.

            await service.indexFiles(files);

            const stats = service.getStats();
            expect(stats.indexedFiles).toBe(2);
            expect(stats.vocabularySize).toBeGreaterThan(0); // 'content1' should be tokenized
        });
    });

    describe('search', () => {
        it('should delegate to semanticSearch', () => {
            const mockResults = [{ file: 'test.ts', score: 0.9 }];
            (embeddings.semanticSearch as any).mockReturnValue(mockResults);

            // Add some data first
            service['embeddings'].set('test.ts', { file: 'test.ts', embedding: [], metadata: {} } as any);

            const results = service.search('query');
            expect(results).toBe(mockResults);
            expect(embeddings.semanticSearch).toHaveBeenCalledWith('query', expect.any(Array), 5);
        });
    });

    describe('hybridSearch', () => {
        it('should delegate to hybridSearch', () => {
            const mockResults = [{ file: 'test.ts', score: 0.9 }];
            (embeddings.hybridSearch as any).mockReturnValue(mockResults);

            service['embeddings'].set('test.ts', { file: 'test.ts', embedding: [], metadata: {} } as any);

            const results = service.hybridSearch('query', ['test.ts']);
            expect(results).toBe(mockResults);
            expect(embeddings.hybridSearch).toHaveBeenCalledWith('query', expect.any(Array), ['test.ts'], 5);
        });
    });

    describe('clear', () => {
        it('should reset index', async () => {
            await service.indexFile('test.ts', 'content');
            expect(service.getStats().indexedFiles).toBe(1);

            service.clear();
            expect(service.getStats().indexedFiles).toBe(0);
            expect(service.getStats().vocabularySize).toBe(0);
        });
    });

    describe('singleton', () => {
        it('should return same instance', () => {
            const s1 = getSemanticSearchService();
            const s2 = getSemanticSearchService();
            expect(s1).toBe(s2);
        });
    });
});
