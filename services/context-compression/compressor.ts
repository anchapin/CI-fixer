/**
 * Attention-Based Context Compressor
 * Implements ATTENTION-RAG compression strategy
 * Based on research: arXiv:2410.05208
 */

import { scoreTokens, TokenScore } from './token-scorer.js';

export interface CompressionResult {
    compressed: string;
    originalLength: number;
    compressedLength: number;
    compressionRatio: number;
    retainedImportance: number;
}

export interface CompressionConfig {
    targetRatio: number;           // Target compression (e.g., 6.0 for 6x)
    minImportanceThreshold: number; // Minimum importance to keep (0-1)
    preserveStructure: boolean;     // Keep sentence boundaries
}

const DEFAULT_CONFIG: CompressionConfig = {
    targetRatio: 6.0,
    minImportanceThreshold: 0.3,
    preserveStructure: true
};

/**
 * Compress text using attention-based pruning
 */
export function compressContext(
    text: string,
    config: CompressionConfig = DEFAULT_CONFIG
): CompressionResult {

    if (!text || text.length === 0) {
        return {
            compressed: '',
            originalLength: 0,
            compressedLength: 0,
            compressionRatio: 1.0,
            retainedImportance: 1.0
        };
    }

    // Score all tokens
    const scores = scoreTokens(text);

    if (scores.length === 0) {
        return {
            compressed: text,
            originalLength: 0,
            compressedLength: 0,
            compressionRatio: 1.0,
            retainedImportance: 1.0
        };
    }

    // Calculate target length
    const targetLength = Math.max(1, Math.floor(scores.length / config.targetRatio));

    // Sort by importance (descending)
    const sortedScores = [...scores].sort((a, b) => b.importance - a.importance);

    // Select top tokens
    const selectedTokens = sortedScores
        .slice(0, targetLength)
        .filter(s => s.importance >= config.minImportanceThreshold)
        .sort((a, b) => a.position - b.position); // Restore original order

    // Reconstruct text
    let compressed = '';
    if (config.preserveStructure) {
        compressed = reconstructWithStructure(selectedTokens, text);
    } else {
        compressed = selectedTokens.map(s => s.token).join(' ');
    }

    // Calculate metrics
    const totalImportance = scores.reduce((sum, s) => sum + s.importance, 0);
    const retainedImportance = selectedTokens.reduce((sum, s) => sum + s.importance, 0);

    return {
        compressed,
        originalLength: scores.length,
        compressedLength: selectedTokens.length,
        compressionRatio: scores.length / Math.max(1, selectedTokens.length),
        retainedImportance: totalImportance > 0 ? retainedImportance / totalImportance : 1.0
    };
}

/**
 * Reconstruct text preserving sentence structure
 */
function reconstructWithStructure(
    selectedTokens: TokenScore[],
    originalText: string
): string {

    const sentences = originalText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const result: string[] = [];

    for (const sentence of sentences) {
        const sentenceTokens = tokenize(sentence);

        // Check if sentence has important tokens
        const importantInSentence = sentenceTokens.filter(token =>
            selectedTokens.some(s => s.token === token)
        );

        if (importantInSentence.length > 0) {
            // Keep sentence with important tokens highlighted
            result.push(importantInSentence.join(' '));
        }
    }

    return result.length > 0 ? result.join('. ') + '.' : selectedTokens.map(s => s.token).join(' ');
}

function tokenize(text: string): string[] {
    return text.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Adaptive compression based on text length
 */
export function adaptiveCompress(
    text: string,
    maxTokens: number
): CompressionResult {

    const currentTokens = estimateTokens(text);

    if (currentTokens <= maxTokens) {
        // No compression needed
        return {
            compressed: text,
            originalLength: currentTokens,
            compressedLength: currentTokens,
            compressionRatio: 1.0,
            retainedImportance: 1.0
        };
    }

    // Calculate required compression ratio
    const targetRatio = currentTokens / maxTokens;

    return compressContext(text, {
        targetRatio,
        minImportanceThreshold: 0.3,
        preserveStructure: true
    });
}

function estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
}
