/**
 * Semantic Search Service
 * Provides semantic code search capabilities for better file localization
 */

import { CodeEmbedding, generateEmbedding, semanticSearch, hybridSearch, SearchResult } from './embeddings.js';
import { SandboxEnvironment } from '../../sandbox.js';

export class SemanticSearchService {
    private embeddings: Map<string, CodeEmbedding> = new Map();
    private vocabulary: Map<string, number> = new Map();

    /**
     * Index a file for semantic search
     */
    async indexFile(filePath: string, content: string, metadata?: any): Promise<void> {
        const embedding = generateEmbedding(content, this.vocabulary);

        this.embeddings.set(filePath, {
            file: filePath,
            embedding,
            metadata: {
                language: this.detectLanguage(filePath),
                size: content.length,
                lastModified: Date.now(),
                ...metadata
            }
        });
    }

    /**
     * Index multiple files
     */
    async indexFiles(files: Map<string, string>): Promise<void> {
        // Build vocabulary from all files first
        this.vocabulary = this.buildVocabulary(Array.from(files.values()));

        // Index each file
        for (const [path, content] of files) {
            await this.indexFile(path, content);
        }

        console.log(`[SemanticSearch] Indexed ${files.size} files with vocabulary size ${this.vocabulary.size}`);
    }

    /**
     * Search for relevant files
     */
    search(query: string, topK: number = 5): SearchResult[] {
        const embeddings = Array.from(this.embeddings.values());
        return semanticSearch(query, embeddings, topK);
    }

    /**
     * Hybrid search combining semantic and keyword matching
     */
    hybridSearch(query: string, keywordMatches: string[], topK: number = 5): SearchResult[] {
        const embeddings = Array.from(this.embeddings.values());
        return hybridSearch(query, embeddings, keywordMatches, topK);
    }

    /**
     * Clear all indexed data
     */
    clear(): void {
        this.embeddings.clear();
        this.vocabulary.clear();
    }

    /**
     * Get statistics
     */
    getStats(): { indexedFiles: number; vocabularySize: number } {
        return {
            indexedFiles: this.embeddings.size,
            vocabularySize: this.vocabulary.size
        };
    }

    // Helper methods

    private detectLanguage(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const langMap: Record<string, string> = {
            'ts': 'typescript',
            'js': 'javascript',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'go': 'go',
            'rs': 'rust'
        };
        return langMap[ext || ''] || 'unknown';
    }

    private buildVocabulary(texts: string[]): Map<string, number> {
        const vocab = new Map<string, number>();
        let idx = 0;

        for (const text of texts) {
            const tokens = this.tokenize(text.toLowerCase());
            for (const token of tokens) {
                if (!vocab.has(token)) {
                    vocab.set(token, idx++);
                }
            }
        }

        return vocab;
    }

    private tokenize(text: string): string[] {
        return text
            .split(/[^a-z0-9_]+/)
            .filter(t => t.length > 2)
            .filter(t => !this.isStopWord(t));
    }

    private isStopWord(token: string): boolean {
        const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has']);
        return stopWords.has(token);
    }
}

/**
 * Global semantic search service instance
 */
let globalSearchService: SemanticSearchService | null = null;

export function getSemanticSearchService(): SemanticSearchService {
    if (!globalSearchService) {
        globalSearchService = new SemanticSearchService();
    }
    return globalSearchService;
}
