/**
 * Token Importance Scorer
 * Assigns importance scores to tokens based on multiple factors
 * Based on ATTENTION-RAG research (arXiv:2410.05208)
 */

export interface TokenScore {
    token: string;
    position: number;
    importance: number;
    category: 'error' | 'code' | 'metadata' | 'context';
}

export interface ScoringWeights {
    errorKeywords: number;      // 0.4 - error messages, stack traces
    codeRelevance: number;       // 0.3 - code snippets, file paths
    recency: number;             // 0.2 - recent tokens more important
    uniqueness: number;          // 0.1 - rare tokens more informative
}

const DEFAULT_WEIGHTS: ScoringWeights = {
    errorKeywords: 0.4,
    codeRelevance: 0.3,
    recency: 0.2,
    uniqueness: 0.1
};

/**
 * Score tokens by importance
 */
export function scoreTokens(
    text: string,
    weights: ScoringWeights = DEFAULT_WEIGHTS
): TokenScore[] {

    const tokens = tokenize(text);
    const scores: TokenScore[] = [];

    // Calculate term frequency for uniqueness
    const termFreq = calculateTermFrequency(tokens);
    const maxFreq = Math.max(...Object.values(termFreq));

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Error keyword score
        const errorScore = isErrorKeyword(token) ? 1.0 : 0.0;

        // Code relevance score
        const codeScore = isCodeToken(token) ? 1.0 : 0.0;

        // Recency score (exponential decay from end)
        const recencyScore = Math.exp(-(tokens.length - i) / tokens.length);

        // Uniqueness score (inverse frequency, normalized)
        const freq = termFreq[token] || 1;
        const uniquenessScore = 1.0 - (freq / maxFreq);

        // Weighted combination
        const importance =
            errorScore * weights.errorKeywords +
            codeScore * weights.codeRelevance +
            recencyScore * weights.recency +
            uniquenessScore * weights.uniqueness;

        scores.push({
            token,
            position: i,
            importance,
            category: categorizeToken(token)
        });
    }

    return scores;
}

/**
 * Tokenize text (simple whitespace split)
 */
function tokenize(text: string): string[] {
    return text.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Calculate term frequency
 */
function calculateTermFrequency(tokens: string[]): Record<string, number> {
    const freq: Record<string, number> = {};
    for (const token of tokens) {
        freq[token] = (freq[token] || 0) + 1;
    }
    return freq;
}

/**
 * Check if token is error-related
 */
function isErrorKeyword(token: string): boolean {
    const errorKeywords = [
        'error', 'exception', 'failed', 'failure', 'undefined',
        'null', 'cannot', 'missing', 'invalid', 'unexpected',
        'at', 'line', 'file', 'stack', 'trace', 'warning',
        'fatal', 'critical', 'assert', 'throw', 'catch'
    ];
    const lower = token.toLowerCase();
    return errorKeywords.some(kw => lower.includes(kw));
}

/**
 * Check if token is code-related
 */
function isCodeToken(token: string): boolean {
    // File paths, function names, variables, module names
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(token) ||
        /\.(ts|js|py|java|cpp|go|rs)$/.test(token) ||
        /^["'].*["']$/.test(token) || // Quoted strings (module names)
        /^\/.*/.test(token) ||
        /^[A-Z][a-z]+[A-Z]/.test(token); // CamelCase
}

/**
 * Categorize token
 */
function categorizeToken(token: string): 'error' | 'code' | 'metadata' | 'context' {
    if (isErrorKeyword(token)) return 'error';
    if (isCodeToken(token)) return 'code';
    if (/^\d+$/.test(token) || /^[A-Z_]+$/.test(token)) return 'metadata';
    return 'context';
}
