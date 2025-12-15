/**
 * Semantic Code Search Module
 * Implements embedding-based semantic search for better code localization
 * Based on CodeBERT and semantic similarity research
 */

export interface CodeEmbedding {
    file: string;
    embedding: number[];
    metadata: {
        language: string;
        size: number;
        lastModified: number;
    };
}

export interface SearchResult {
    file: string;
    score: number;
    snippet?: string;
}

/**
 * Generate semantic embedding for code/text
 * Uses a simple TF-IDF-like approach as a lightweight alternative to CodeBERT
 * For production, this would integrate with actual CodeBERT or similar model
 */
export function generateEmbedding(text: string, vocabulary?: Map<string, number>): number[] {
    // Tokenize and normalize
    const tokens = tokenize(text.toLowerCase());

    // Build vocabulary if not provided
    const vocab = vocabulary || buildVocabulary([text]);

    // Create embedding vector (bag-of-words with TF-IDF weighting)
    const embedding = new Array(vocab.size).fill(0);
    const termFreq = new Map<string, number>();

    // Calculate term frequency
    for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    // Populate embedding vector
    for (const [token, freq] of termFreq) {
        const idx = vocab.get(token);
        if (idx !== undefined) {
            // Simple TF weighting (could add IDF for better results)
            embedding[idx] = freq / tokens.length;
        }
    }

    // Normalize to unit vector
    return normalizeVector(embedding);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Embeddings must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
}

/**
 * Search for similar code using semantic embeddings
 */
export function semanticSearch(
    query: string,
    codeEmbeddings: CodeEmbedding[],
    topK: number = 5,
    vocabulary?: Map<string, number>
): SearchResult[] {

    if (codeEmbeddings.length === 0) {
        return [];
    }

    // Extract vocabulary from existing embeddings if not provided
    const vocab = vocabulary || extractVocabulary(codeEmbeddings);

    // Generate query embedding using same vocabulary
    const queryEmbedding = generateEmbedding(query, vocab);

    // Ensure query embedding has same dimension as code embeddings
    const targetDim = codeEmbeddings[0].embedding.length;
    const paddedQuery = padOrTruncate(queryEmbedding, targetDim);

    // Calculate similarity scores
    const results: SearchResult[] = codeEmbeddings.map(ce => ({
        file: ce.file,
        score: cosineSimilarity(paddedQuery, ce.embedding)
    }));

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Return top K results
    return results.slice(0, topK);
}

/**
 * Hybrid search: combine keyword and semantic search
 */
export function hybridSearch(
    query: string,
    codeEmbeddings: CodeEmbedding[],
    keywordMatches: string[],
    topK: number = 5,
    semanticWeight: number = 0.7
): SearchResult[] {

    // Get semantic results
    const semanticResults = semanticSearch(query, codeEmbeddings, topK * 2);

    // Boost scores for keyword matches
    const boostedResults = semanticResults.map(result => {
        const keywordBoost = keywordMatches.includes(result.file) ? 0.3 : 0;
        return {
            ...result,
            score: result.score * semanticWeight + keywordBoost * (1 - semanticWeight)
        };
    });

    // Re-sort and return top K
    boostedResults.sort((a, b) => b.score - a.score);
    return boostedResults.slice(0, topK);
}

// Helper functions

export function tokenize(text: string): string[] {
    // Split on non-alphanumeric, keep meaningful tokens
    return text
        .split(/[^a-z0-9_]+/)
        .filter(t => t.length > 2) // Filter out very short tokens
        .filter(t => !isStopWord(t));
}

function isStopWord(token: string): boolean {
    const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has']);
    return stopWords.has(token);
}

export function buildVocabulary(texts: string[]): Map<string, number> {
    const vocab = new Map<string, number>();
    let idx = 0;

    for (const text of texts) {
        const tokens = tokenize(text.toLowerCase());
        for (const token of tokens) {
            if (!vocab.has(token)) {
                vocab.set(token, idx++);
            }
        }
    }

    return vocab;
}

function extractVocabulary(embeddings: CodeEmbedding[]): Map<string, number> {
    // Build vocabulary from embedding dimensions
    // In a real implementation, this would be stored with the embeddings
    const vocab = new Map<string, number>();

    // For now, create a dummy vocabulary matching the embedding size
    if (embeddings.length > 0) {
        const embeddingSize = embeddings[0].embedding.length;
        for (let i = 0; i < embeddingSize; i++) {
            vocab.set(`token_${i}`, i);
        }
    }

    return vocab;
}

function padOrTruncate(vec: number[], targetLength: number): number[] {
    if (vec.length === targetLength) return vec;
    if (vec.length > targetLength) return vec.slice(0, targetLength);

    // Pad with zeros
    const padded = [...vec];
    while (padded.length < targetLength) {
        padded.push(0);
    }
    return padded;
}

function normalizeVector(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vec;
    return vec.map(val => val / norm);
}
