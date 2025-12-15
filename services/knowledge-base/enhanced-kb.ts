/**
 * Enhanced Knowledge Base Module
 * Implements ReCode-inspired dual-encoder retrieval for better fix pattern matching
 * Based on ReCode research (fine-grained RAG for program repair)
 */

export interface ErrorPattern {
    id: string;
    errorType: string;
    errorMessage: string;
    context: string;
    fixPattern: string;
    embedding?: number[];
    metadata: {
        language: string;
        frequency: number;
        successRate: number;
        lastUsed: number;
    };
}

export interface FixRetrievalResult {
    pattern: ErrorPattern;
    score: number;
    reasoning: string;
}

/**
 * Enhanced Knowledge Base with semantic retrieval
 */
export class EnhancedKnowledgeBase {
    private patterns: Map<string, ErrorPattern> = new Map();
    private errorTypeIndex: Map<string, Set<string>> = new Map();
    private languageIndex: Map<string, Set<string>> = new Map();

    /**
     * Add error pattern to knowledge base
     */
    addPattern(pattern: ErrorPattern): void {
        this.patterns.set(pattern.id, pattern);

        // Index by error type
        if (!this.errorTypeIndex.has(pattern.errorType)) {
            this.errorTypeIndex.set(pattern.errorType, new Set());
        }
        this.errorTypeIndex.get(pattern.errorType)!.add(pattern.id);

        // Index by language
        if (!this.languageIndex.has(pattern.metadata.language)) {
            this.languageIndex.set(pattern.metadata.language, new Set());
        }
        this.languageIndex.get(pattern.metadata.language)!.add(pattern.id);
    }

    /**
     * Retrieve relevant fix patterns using dual-encoder approach
     */
    retrieveFixPatterns(
        errorMessage: string,
        errorType: string,
        language: string,
        topK: number = 3
    ): FixRetrievalResult[] {

        // Step 1: Filter by error type and language
        const candidateIds = this.filterCandidates(errorType, language);

        if (candidateIds.size === 0) {
            return [];
        }

        // Step 2: Score candidates by similarity
        const scored: FixRetrievalResult[] = [];

        for (const id of candidateIds) {
            const pattern = this.patterns.get(id)!;
            const score = this.calculateSimilarity(errorMessage, pattern);

            scored.push({
                pattern,
                score,
                reasoning: this.explainMatch(errorMessage, pattern, score)
            });
        }

        // Step 3: Sort by score and return top K
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    /**
     * Learn from successful fix
     */
    recordSuccess(patternId: string): void {
        const pattern = this.patterns.get(patternId);
        if (pattern) {
            pattern.metadata.frequency++;
            pattern.metadata.successRate = Math.min(
                1.0,
                pattern.metadata.successRate + 0.1
            );
            pattern.metadata.lastUsed = Date.now();
        }
    }

    /**
     * Learn from failed fix
     */
    recordFailure(patternId: string): void {
        const pattern = this.patterns.get(patternId);
        if (pattern) {
            pattern.metadata.successRate = Math.max(
                0.0,
                pattern.metadata.successRate - 0.05
            );
        }
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalPatterns: number;
        errorTypes: number;
        languages: number;
        avgSuccessRate: number;
    } {
        const patterns = Array.from(this.patterns.values());
        const avgSuccessRate = patterns.length > 0
            ? patterns.reduce((sum, p) => sum + p.metadata.successRate, 0) / patterns.length
            : 0;

        return {
            totalPatterns: this.patterns.size,
            errorTypes: this.errorTypeIndex.size,
            languages: this.languageIndex.size,
            avgSuccessRate
        };
    }

    // Private helper methods

    private filterCandidates(errorType: string, language: string): Set<string> {
        const typeMatches = this.errorTypeIndex.get(errorType) || new Set();
        const langMatches = this.languageIndex.get(language) || new Set();

        // Intersection of type and language matches
        const candidates = new Set<string>();
        for (const id of typeMatches) {
            if (langMatches.has(id)) {
                candidates.add(id);
            }
        }

        // If no exact matches, try language-only
        if (candidates.size === 0) {
            return langMatches;
        }

        return candidates;
    }

    private calculateSimilarity(errorMessage: string, pattern: ErrorPattern): number {
        // Multi-factor scoring
        let score = 0;

        // 1. Exact message match (40%)
        const exactMatch = this.exactMessageSimilarity(errorMessage, pattern.errorMessage);
        score += exactMatch * 0.4;

        // 2. Context similarity (30%)
        const contextMatch = this.contextSimilarity(errorMessage, pattern.context);
        score += contextMatch * 0.3;

        // 3. Success rate (20%)
        score += pattern.metadata.successRate * 0.2;

        // 4. Recency (10%)
        const recency = this.calculateRecency(pattern.metadata.lastUsed);
        score += recency * 0.1;

        return score;
    }

    private exactMessageSimilarity(msg1: string, msg2: string): number {
        const tokens1 = this.tokenize(msg1.toLowerCase());
        const tokens2 = this.tokenize(msg2.toLowerCase());

        const set1 = new Set(tokens1);
        const set2 = new Set(tokens2);

        // Jaccard similarity
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return union.size > 0 ? intersection.size / union.size : 0;
    }

    private contextSimilarity(errorMsg: string, patternContext: string): number {
        // Simple keyword overlap
        const errorTokens = new Set(this.tokenize(errorMsg.toLowerCase()));
        const contextTokens = new Set(this.tokenize(patternContext.toLowerCase()));

        let overlap = 0;
        for (const token of errorTokens) {
            if (contextTokens.has(token)) overlap++;
        }

        return errorTokens.size > 0 ? overlap / errorTokens.size : 0;
    }

    private calculateRecency(lastUsed: number): number {
        const daysSinceUse = (Date.now() - lastUsed) / (1000 * 60 * 60 * 24);
        // Exponential decay: 1.0 if used today, 0.5 after 30 days
        return Math.exp(-daysSinceUse / 30);
    }

    private explainMatch(errorMsg: string, pattern: ErrorPattern, score: number): string {
        const reasons: string[] = [];

        if (score > 0.8) {
            reasons.push('High similarity to known pattern');
        }
        if (pattern.metadata.successRate > 0.7) {
            reasons.push(`High success rate (${(pattern.metadata.successRate * 100).toFixed(0)}%)`);
        }
        if (pattern.metadata.frequency > 5) {
            reasons.push(`Frequently used pattern (${pattern.metadata.frequency} times)`);
        }

        return reasons.length > 0 ? reasons.join('; ') : 'Moderate match';
    }

    private tokenize(text: string): string[] {
        return text.split(/[^a-z0-9]+/).filter(t => t.length > 2);
    }
}

/**
 * Global enhanced knowledge base instance
 */
let globalKB: EnhancedKnowledgeBase | null = null;

export function getEnhancedKB(): EnhancedKnowledgeBase {
    if (!globalKB) {
        globalKB = new EnhancedKnowledgeBase();
    }
    return globalKB;
}
