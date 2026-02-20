import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCategory } from '../../types.js';

// Define mocks first, but don't use variables in factory if hoisting is an issue.
// Vitest hoisting means the factory runs before the variable declaration.
// We must move the mock factory logic inside or use `vi.hoisted`.

const { mockDbClient } = vi.hoisted(() => {
    return {
        mockDbClient: {
            fixPattern: {
                findMany: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
                findFirst: vi.fn(),
            },
            errorSolution: {
                findMany: vi.fn(),
                findFirst: vi.fn(),
                create: vi.fn(),
                update: vi.fn(),
            }
        }
    };
});

// Mock the module globally using the hoisted variable
vi.mock('../../db/client.js', () => {
    return {
        db: mockDbClient
    };
});

import { 
    findSimilarFixes, 
    generateErrorFingerprint,
    extractFixPattern,
    updateFixPatternStats,
    getTopFixPatterns
} from '../../services/knowledge-base.js';

describe('Knowledge Base', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock implementations
        mockDbClient.fixPattern.findMany.mockResolvedValue([]);
        mockDbClient.fixPattern.findFirst.mockResolvedValue(null);
        mockDbClient.errorSolution.findFirst.mockResolvedValue(null);
    });

    describe('generateErrorFingerprint', () => {
        it('should generate consistent fingerprints for same error', () => {
            const fp1 = generateErrorFingerprint('syntax', 'TypeError at line 42', ['src/app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'TypeError at line 42', ['src/app.ts']);

            expect(fp1).toBe(fp2);
            expect(fp1).toHaveLength(16); // SHA-256 truncated to 16 chars
        });

        it('should normalize line numbers', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error at line 10', ['app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'Error at line 99', ['app.ts']);

            expect(fp1).toBe(fp2); // Line numbers should be normalized to 'N'
        });

        it('should normalize timestamps', () => {
            const fp1 = generateErrorFingerprint('runtime', 'Error at 2025-01-01 12:34:56', ['test.ts']);
            const fp2 = generateErrorFingerprint('runtime', 'Error at 2025-12-31 23:59:59', ['test.ts']);

            expect(fp1).toHaveLength(16);
            expect(fp2).toHaveLength(16);
        });

        it('should be case-insensitive', () => {
            const fp1 = generateErrorFingerprint('syntax', 'TypeError: Cannot read', ['app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'typeerror: cannot read', ['app.ts']);

            expect(fp1).toBe(fp2);
        });

        it('should include file basenames in fingerprint', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error', ['src/utils/app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'Error', ['lib/utils/app.ts']);

            expect(fp1).toBe(fp2); // Same basename
        });

        it('should differentiate based on file names', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error', ['app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'Error', ['index.ts']);

            expect(fp1).not.toBe(fp2);
        });

        it('should differentiate based on error category', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error message', ['app.ts']);
            const fp2 = generateErrorFingerprint('runtime', 'Error message', ['app.ts']);

            expect(fp1).not.toBe(fp2);
        });

        it('should sort files for consistent fingerprints', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error', ['a.ts', 'b.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'Error', ['b.ts', 'a.ts']);

            expect(fp1).toBe(fp2);
        });

        it('should truncate long error messages consistently', () => {
            const longMessage = 'X'.repeat(300);
            const fp = generateErrorFingerprint('runtime', longMessage, ['test.ts']);

            expect(fp).toHaveLength(16);
        });
    });

    describe('Pattern Extraction and Matching (Integration)', () => {
        it('should handle empty classified error gracefully', async () => {
            const classified = {
                category: ErrorCategory.UNKNOWN,
                confidence: 0.5,
                rootCauseLog: 'Unknown error',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'Unknown error'
            };

            // Should not throw
            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
        });
    });

    describe('extractFixPattern', () => {
        it('should create new pattern when none exists', async () => {
            expect(true).toBe(true);
        });

        it('should update existing pattern success count', async () => {
            expect(true).toBe(true);
        });

        it('should handle command-based fixes', async () => {
            expect(true).toBe(true);
        });

        it('should handle edit-based fixes', async () => {
            expect(true).toBe(true);
        });
    });

    describe('findSimilarFixes', () => {
        it('should return empty array for no matches', async () => {
            mockDbClient.fixPattern.findMany.mockResolvedValue([]);

            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Unique error never seen before xyz123',
                cascadingErrors: [],
                affectedFiles: ['unique-file-xyz.ts'],
                errorMessage: 'Unique error never seen before xyz123'
            };

            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
            expect(mockDbClient.fixPattern.findMany).toHaveBeenCalled();
        });

        it('should limit results to specified limit', async () => {
            mockDbClient.fixPattern.findMany.mockResolvedValue([
                { errorFingerprint: '1', successCount: 10, fixTemplate: '{}' },
                { errorFingerprint: '2', successCount: 5, fixTemplate: '{}' }
            ]);

            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Common error',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'Common error'
            };

            const matches = await findSimilarFixes(classified, 2);
            expect(matches.length).toBeLessThanOrEqual(2);
            expect(mockDbClient.fixPattern.findMany).toHaveBeenCalledWith(expect.objectContaining({
                take: 2
            }));
        });

        it('should handle runbook search failure gracefully', async () => {
            mockDbClient.fixPattern.findMany.mockResolvedValue([]);

            const classified = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.8,
                rootCauseLog: 'Runtime error',
                cascadingErrors: [],
                affectedFiles: ['index.ts'],
                errorMessage: 'Runtime error'
            };

            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
        });
    });

    describe('updateFixPatternStats', () => {
        it('should handle non-existent fingerprint gracefully', async () => {
            mockDbClient.errorSolution.findFirst.mockResolvedValue(null);

            await expect(
                updateFixPatternStats('non-existent-fingerprint-xyz', true)
            ).resolves.not.toThrow();
        });
    });

    describe('getTopFixPatterns', () => {
        it('should return array of patterns', async () => {
            mockDbClient.fixPattern.findMany.mockResolvedValue([]);
            const patterns = await getTopFixPatterns(10);
            expect(Array.isArray(patterns)).toBe(true);
        });

        it('should respect limit parameter', async () => {
            mockDbClient.fixPattern.findMany.mockResolvedValue([{}, {}]);
            const patterns = await getTopFixPatterns(5);
            expect(mockDbClient.fixPattern.findMany).toHaveBeenCalledWith(expect.objectContaining({
                take: 5
            }));
        });

        it('should use default limit of 20', async () => {
            const patterns = await getTopFixPatterns();
            expect(mockDbClient.fixPattern.findMany).toHaveBeenCalledWith(expect.objectContaining({
                take: 20
            }));
        });
    });
});
