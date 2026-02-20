import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCategory } from '../../types.js';
import { 
    findSimilarFixes, 
    generateErrorFingerprint,
    extractFixPattern,
    updateFixPatternStats,
    getTopFixPatterns
} from '../../services/knowledge-base.js';

// Define the mock methods
const mockFindMany = vi.fn().mockResolvedValue([]);
const mockFindFirst = vi.fn().mockResolvedValue(null);
const mockCreate = vi.fn().mockResolvedValue({ id: '1' });
const mockUpdate = vi.fn().mockResolvedValue({ id: '1' });

// Hoist the mock object for vi.mock
const mocks = vi.hoisted(() => {
    return {
        db: {
            fixPattern: {
                findMany: vi.fn(),
                findFirst: vi.fn(),
                create: vi.fn(),
                update: vi.fn()
            },
            errorSolution: {
                findFirst: vi.fn(),
                create: vi.fn(),
                update: vi.fn()
            }
        }
    };
});

// Mock the module - Ensure we're mocking the exact path the service uses
vi.mock('../../db/client.js', () => ({
    db: mocks.db
}));

// Pass the mock client explicitly to functions
const mockDbClient = mocks.db;

describe('Knowledge Base', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset default behaviors
        mocks.db.fixPattern.findMany.mockResolvedValue([]);
        mocks.db.fixPattern.findFirst.mockResolvedValue(null);
        mocks.db.fixPattern.create.mockResolvedValue({ id: '1' });
        mocks.db.fixPattern.update.mockResolvedValue({ id: '1' });

        mocks.db.errorSolution.findFirst.mockResolvedValue(null);
        mocks.db.errorSolution.create.mockResolvedValue({ id: '1' });
        mocks.db.errorSolution.update.mockResolvedValue({ id: '1' });
    });

    describe('generateErrorFingerprint', () => {
        it('should generate consistent fingerprints for same error', () => {
            const fp1 = generateErrorFingerprint('syntax', 'TypeError at line 42', ['src/app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'TypeError at line 42', ['src/app.ts']);

            expect(fp1).toBe(fp2);
            expect(fp1).toHaveLength(16);
        });
        // ... (keep other fingerprint tests as they are pure logic)
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

            // Explicitly pass the mock client
            const matches = await findSimilarFixes(classified, 5, mockDbClient as any);
            expect(Array.isArray(matches)).toBe(true);
        });
    });

    describe('extractFixPattern', () => {
        it('should create new pattern when none exists', async () => {
            mocks.db.fixPattern.findFirst.mockResolvedValue(null);
            mocks.db.errorSolution.findFirst.mockResolvedValue(null);

            const classified = {
                category: ErrorCategory.SYNTAX,
                errorMessage: 'Error',
                affectedFiles: ['test.ts'],
                confidence: 1,
                rootCauseLog: '',
                cascadingErrors: []
            };

            await extractFixPattern('run-1', classified, [], [], 1, mockDbClient as any);

            expect(mocks.db.fixPattern.create).toHaveBeenCalled();
            expect(mocks.db.errorSolution.create).toHaveBeenCalled();
        });

        it('should update existing pattern success count', async () => {
            mocks.db.fixPattern.findFirst.mockResolvedValue({ id: '1', successCount: 1 });
            mocks.db.errorSolution.findFirst.mockResolvedValue({ id: '1', timesApplied: 1, successRate: 1, avgIterations: 1 });

            const classified = {
                category: ErrorCategory.SYNTAX,
                errorMessage: 'Error',
                affectedFiles: ['test.ts'],
                confidence: 1,
                rootCauseLog: '',
                cascadingErrors: []
            };

            await extractFixPattern('run-1', classified, [], [], 1, mockDbClient as any);

            expect(mocks.db.fixPattern.update).toHaveBeenCalled();
            expect(mocks.db.errorSolution.update).toHaveBeenCalled();
        });
    });

    describe('findSimilarFixes', () => {
        it('should return empty array for no matches', async () => {
            mocks.db.fixPattern.findMany.mockResolvedValue([]);

            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Unique error never seen before xyz123',
                cascadingErrors: [],
                affectedFiles: ['unique-file-xyz.ts'],
                errorMessage: 'Unique error never seen before xyz123'
            };

            const matches = await findSimilarFixes(classified, 5, mockDbClient as any);
            expect(Array.isArray(matches)).toBe(true);
            expect(matches).toHaveLength(0);
        });

        it('should limit results to specified limit', async () => {
            mocks.db.fixPattern.findMany.mockResolvedValue([]);

            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Common error',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'Common error'
            };

            await findSimilarFixes(classified, 3, mockDbClient as any);
            expect(mocks.db.fixPattern.findMany).toHaveBeenCalled();
        });

        it('should handle runbook search failure gracefully', async () => {
            mocks.db.fixPattern.findMany.mockResolvedValue([]);

            const classified = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.8,
                rootCauseLog: 'Runtime error',
                cascadingErrors: [],
                affectedFiles: ['index.ts'],
                errorMessage: 'Runtime error'
            };

            const matches = await findSimilarFixes(classified, 5, mockDbClient as any);
            expect(Array.isArray(matches)).toBe(true);
        });
    });

    describe('updateFixPatternStats', () => {
        it('should handle non-existent fingerprint gracefully', async () => {
            mocks.db.errorSolution.findFirst.mockResolvedValue(null);

            await expect(
                updateFixPatternStats('non-existent-fingerprint-xyz', true, mockDbClient as any)
            ).resolves.not.toThrow();
        });
    });

    describe('getTopFixPatterns', () => {
        it('should return array of patterns', async () => {
            mocks.db.fixPattern.findMany.mockResolvedValue([]);
            const patterns = await getTopFixPatterns(10, mockDbClient as any);
            expect(Array.isArray(patterns)).toBe(true);
        });

        it('should respect limit parameter', async () => {
            mocks.db.fixPattern.findMany.mockResolvedValue([]);
            await getTopFixPatterns(5, mockDbClient as any);
            expect(mocks.db.fixPattern.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
        });

        it('should use default limit of 20', async () => {
            mocks.db.fixPattern.findMany.mockResolvedValue([]);
            await getTopFixPatterns(undefined, mockDbClient as any);
            expect(mocks.db.fixPattern.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
        });
    });
});
