import { db as prisma } from '../db/client.js';
import { createHash } from 'crypto';
import { ClassifiedError } from '../errorClassification.js';
import { FileChange } from '../types.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface FixPatternMatch {
    pattern: {
        id: string;
        errorFingerprint: string;
        errorCategory: string;
        filePath: string;
        fixTemplate: string;
        successCount: number;
        lastUsed: Date;
    };
    similarity: number; // 0.0 - 1.0
    successCount: number;
}

export interface FixTemplate {
    action: 'edit' | 'command';
    command?: string;
    edits?: Array<{
        filePath: string;
        changes: string;
    }>;
}

// ============================================================================
// ERROR FINGERPRINTING
// ============================================================================

/**
 * Generates a stable fingerprint for an error based on its characteristics.
 * Used for similarity matching across different runs.
 */
export function generateErrorFingerprint(
    errorCategory: string,
    errorMessage: string,
    affectedFiles: string[]
): string {
    // Normalize error message - remove line numbers, timestamps, specific values
    const normalized = errorMessage
        .toLowerCase()
        .replace(/\d+/g, 'N')  // Replace numbers with 'N'
        .replace(/line \d+/gi, 'line N')
        .replace(/at .+:\d+:\d+/g, 'at FILE:N:N')
        .replace(/['"]/g, '')  // Remove quotes
        .trim();

    // Sort files for consistent ordering
    const sortedFiles = [...affectedFiles].sort();

    // Create fingerprint from category + normalized message + file basenames
    const fileBasenames = sortedFiles.map(f => f.split('/').pop() || f);
    const fingerprintData = [
        errorCategory,
        normalized.substring(0, 200), // First 200 chars
        ...fileBasenames
    ].join('|');

    return createHash('sha256').update(fingerprintData).digest('hex').substring(0, 16);
}

// ============================================================================
// PATTERN EXTRACTION
// ============================================================================

/**
 * Extracts a reusable fix pattern from a successful agent run.
 * Stores the pattern for future similarity matching.
 * @param runId - The agent run ID
 * @param classifiedError - The classified error that was fixed
 * @param filesChanged - Files that were modified during the fix
 * @param commandsUsed - Commands that were executed during the fix
 * @param iteration - The iteration count when the fix was successful
 * @param dbClient - Optional database client for testing (defaults to global prisma)
 */
export async function extractFixPattern(
    runId: string,
    classifiedError: ClassifiedError,
    filesChanged: FileChange[],
    commandsUsed: string[],
    iteration: number,
    dbClient = prisma
): Promise<void> {
    const fingerprint = generateErrorFingerprint(
        classifiedError.category,
        classifiedError.errorMessage,
        classifiedError.affectedFiles
    );

    // Create fix template
    const fixTemplate: FixTemplate = {
        action: commandsUsed.length > 0 ? 'command' : 'edit',
        command: commandsUsed.length > 0 ? commandsUsed[0] : undefined,
        edits: filesChanged.map(fc => ({
            filePath: fc.path,
            changes: fc.modified.content.substring(0, 500) // Store snippet
        }))
    };

    // Check if pattern already exists
    const existing = await dbClient.fixPattern.findFirst({
        where: {
            errorFingerprint: fingerprint,
            errorCategory: classifiedError.category
        }
    });

    if (existing) {
        // Update success count
        await dbClient.fixPattern.update({
            where: { id: existing.id },
            data: {
                successCount: existing.successCount + 1,
                lastUsed: new Date()
            }
        });
    } else {
        // Create new pattern
        await dbClient.fixPattern.create({
            data: {
                errorFingerprint: fingerprint,
                errorCategory: classifiedError.category,
                filePath: classifiedError.affectedFiles[0] || 'unknown',
                fixTemplate: JSON.stringify(fixTemplate),
                successCount: 1
            }
        });
    }

    // Also create/update ErrorSolution entry
    const existingSolution = await dbClient.errorSolution.findFirst({
        where: { errorFingerprint: fingerprint }
    });

    if (existingSolution) {
        const newTimesApplied = existingSolution.timesApplied + 1;
        const newSuccessRate = ((existingSolution.successRate * existingSolution.timesApplied) + 1.0) / newTimesApplied;

        // Update average iterations using weighted average
        const newAvgIterations = ((existingSolution.avgIterations * existingSolution.timesApplied) + iteration) / newTimesApplied;

        await dbClient.errorSolution.update({
            where: { id: existingSolution.id },
            data: {
                timesApplied: newTimesApplied,
                successRate: newSuccessRate,
                avgIterations: newAvgIterations
            }
        });
    } else {
        await dbClient.errorSolution.create({
            data: {
                errorFingerprint: fingerprint,
                solution: JSON.stringify(fixTemplate),
                filesAffected: JSON.stringify(filesChanged.map(fc => fc.path)),
                commandsUsed: JSON.stringify(commandsUsed),
                successRate: 1.0,
                timesApplied: 1,
                avgIterations: iteration
            }
        });
    }
}

// ============================================================================
// SIMILARITY MATCHING
// ============================================================================

/**
 * Calculates Levenshtein distance between two strings.
 * Used for fuzzy matching of error messages.
 */
function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Calculates similarity score between 0.0 and 1.0.
 */
function calculateSimilarity(str1: string, str2: string): number {
    const distance = levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength === 0 ? 1.0 : 1.0 - (distance / maxLength);
}

/**
 * Finds similar historical fixes for a given error.
 * First checks Markdown runbooks, then falls back to database patterns.
 * Returns matches sorted by similarity score.
 * @param dbClient - Optional database client for testing (defaults to global prisma)
 */
export async function findSimilarFixes(
    classifiedError: ClassifiedError,
    limit: number = 5,
    dbClient = prisma
): Promise<FixPatternMatch[]> {
    const currentFingerprint = generateErrorFingerprint(
        classifiedError.category,
        classifiedError.errorMessage,
        classifiedError.affectedFiles
    );

    // 1. Try Markdown runbooks first (human-curated, faster)
    try {
        const { searchRunbooks } = await import('./knowledge-base/markdown-loader.js');

        const runbookMatches = await searchRunbooks({
            category: classifiedError.category,
            fingerprint: currentFingerprint
        });

        if (runbookMatches.length > 0) {
            // Convert runbooks to FixPatternMatch format
            const matches: FixPatternMatch[] = runbookMatches.map(runbook => ({
                pattern: {
                    id: runbook.metadata.fingerprint,
                    errorFingerprint: runbook.metadata.fingerprint,
                    errorCategory: runbook.metadata.category,
                    filePath: 'runbook',
                    fixTemplate: JSON.stringify({
                        action: 'edit',
                        solution: runbook.solution,
                        codeTemplate: runbook.codeTemplate
                    }),
                    successCount: runbook.metadata.success_count,
                    lastUsed: new Date(runbook.metadata.last_updated)
                },
                similarity: runbook.metadata.fingerprint === currentFingerprint ? 1.0 : 0.8,
                successCount: runbook.metadata.success_count
            }));

            if (matches.length >= limit) {
                return matches.slice(0, limit);
            }
        }
    } catch (error) {
        console.warn('Failed to load runbooks, falling back to database:', error);
    }

    // 2. Fall back to database patterns
    // First, try exact match
    const exactMatches = await dbClient.fixPattern.findMany({
        where: {
            errorFingerprint: currentFingerprint,
            errorCategory: classifiedError.category
        },
        orderBy: { successCount: 'desc' },
        take: limit
    });

    if (exactMatches.length > 0) {
        return exactMatches.map(pattern => ({
            pattern,
            similarity: 1.0,
            successCount: pattern.successCount
        }));
    }

    // If no exact match, find similar patterns in same category
    const categoryMatches = await dbClient.fixPattern.findMany({
        where: {
            errorCategory: classifiedError.category
        },
        orderBy: { successCount: 'desc' },
        take: 50 // Get more candidates for similarity filtering
    });

    // Calculate similarity for each candidate
    const matches: FixPatternMatch[] = categoryMatches
        .map(pattern => {
            const similarity = calculateSimilarity(
                currentFingerprint,
                pattern.errorFingerprint
            );
            return {
                pattern,
                similarity,
                successCount: pattern.successCount
            };
        })
        .filter(match => match.similarity > 0.6) // Only keep reasonably similar
        .sort((a, b) => {
            // Sort by similarity first, then success count
            if (Math.abs(a.similarity - b.similarity) > 0.1) {
                return b.similarity - a.similarity;
            }
            return b.successCount - a.successCount;
        })
        .slice(0, limit);

    return matches;
}


/**
 * Updates success statistics for a fix pattern after verification.
 * @param dbClient - Optional database client for testing (defaults to global prisma)
 */
export async function updateFixPatternStats(
    fingerprint: string,
    success: boolean,
    dbClient = prisma
): Promise<void> {
    const solution = await dbClient.errorSolution.findFirst({
        where: { errorFingerprint: fingerprint }
    });

    if (solution) {
        const newTimesApplied = solution.timesApplied + 1;
        const successIncrement = success ? 1.0 : 0.0;
        const newSuccessRate = ((solution.successRate * solution.timesApplied) + successIncrement) / newTimesApplied;

        await dbClient.errorSolution.update({
            where: { id: solution.id },
            data: {
                timesApplied: newTimesApplied,
                successRate: newSuccessRate
            }
        });
    }
}

/**
 * Gets all fix patterns with high success rates.
 * Useful for reviewing what fixes work best.
 * @param dbClient - Optional database client for testing (defaults to global prisma)
 */
export async function getTopFixPatterns(limit: number = 20, dbClient = prisma) {
    return await dbClient.fixPattern.findMany({
        orderBy: [
            { successCount: 'desc' },
            { lastUsed: 'desc' }
        ],
        take: limit
    });
}
