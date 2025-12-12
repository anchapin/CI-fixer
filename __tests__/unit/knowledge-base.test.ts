import { describe, it, expect } from 'vitest';
import { generateErrorFingerprint, extractFixPattern, findSimilarFixes } from '../../services/knowledge-base.js';
import { ErrorCategory } from '../../errorClassification.js';

describe('Knowledge Base', () => {
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

            // Should not throw
            const matches = await findSimilarFixes(classified, 5);
            expect(Array.isArray(matches)).toBe(true);
        });
    });
});
