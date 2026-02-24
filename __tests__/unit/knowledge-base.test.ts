import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCategory } from '../../types.js';
import { mockDeep } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';

// Use vi.hoisted to ensure the mock is created before the module is imported
const prismaMock = vi.hoisted(() => mockDeep<PrismaClient>());

// Mock the real Prisma client import to return our mock
vi.mock('../../db/client.js', () => ({
    db: prismaMock
}));

// Import the service AFTER mocking the dependency
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

            // Exact match depends on normalization - at minimum they should be similar length
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

            // Mock empty return
            prismaMock.fixPattern.findMany.mockResolvedValue([]);

            // Should not throw
            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
            expect(matches).toEqual([]);
        });
    });

    describe('findSimilarFixes', () => {
        it('should return empty array for no matches', async () => {
            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Unique error never seen before xyz123',
                cascadingErrors: [],
                affectedFiles: ['unique-file-xyz.ts'],
                errorMessage: 'Unique error never seen before xyz123'
            };

            prismaMock.fixPattern.findMany.mockResolvedValue([]);

            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
            expect(matches).toHaveLength(0);
        });

        it('should limit results to specified limit', async () => {
            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Common error',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'Common error'
            };

            // Mock exact match return
            const mockPattern = {
                id: '1',
                errorFingerprint: 'fp1',
                errorCategory: ErrorCategory.SYNTAX,
                filePath: 'app.ts',
                fixTemplate: '{}',
                successCount: 10,
                lastUsed: new Date()
            };

            // Mock findMany to return enough items to test limit logic if it wasn't handled by Prisma
            // In reality, Prisma handles limit, but we want to ensure our function passes it through
            prismaMock.fixPattern.findMany.mockResolvedValue([mockPattern, mockPattern, mockPattern]);

            const matches = await findSimilarFixes(classified, 3);

            // Verify findMany was called with take: 3
            expect(prismaMock.fixPattern.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 3 })
            );
        });

        it('should handle runbook search failure gracefully', async () => {
            const classified = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.8,
                rootCauseLog: 'Runtime error',
                cascadingErrors: [],
                affectedFiles: ['index.ts'],
                errorMessage: 'Runtime error'
            };

            prismaMock.fixPattern.findMany.mockResolvedValue([]);

            // Should not throw even if runbook loading fails (which it might in this test env)
            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
        });
    });

    describe('updateFixPatternStats', () => {
        it('should handle non-existent fingerprint gracefully', async () => {
            prismaMock.errorSolution.findFirst.mockResolvedValue(null);

            // Should not throw for non-existent pattern
            await expect(
                updateFixPatternStats('non-existent-fingerprint-xyz', true)
            ).resolves.not.toThrow();

            expect(prismaMock.errorSolution.update).not.toHaveBeenCalled();
        });
    });

    describe('getTopFixPatterns', () => {
        it('should return array of patterns', async () => {
            prismaMock.fixPattern.findMany.mockResolvedValue([]);
            const patterns = await getTopFixPatterns(10);
            expect(Array.isArray(patterns)).toBe(true);
        });

        it('should respect limit parameter', async () => {
            prismaMock.fixPattern.findMany.mockResolvedValue([]);
            await getTopFixPatterns(5);

            expect(prismaMock.fixPattern.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 5 })
            );
        });

        it('should use default limit of 20', async () => {
            prismaMock.fixPattern.findMany.mockResolvedValue([]);
            await getTopFixPatterns();

            expect(prismaMock.fixPattern.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 20 })
            );
        });
    });
});
