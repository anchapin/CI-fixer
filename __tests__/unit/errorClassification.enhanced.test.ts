import { describe, it, expect, vi } from 'vitest';
import { classifyError, isCascadingError, classifyErrorWithHistory } from '../../errorClassification';
import { ErrorCategory } from '../../types';

describe('Error Classification Enhanced', () => {
    describe('classifyError', () => {
        it('should skip non-error log lines', () => {
            const logs = '[INFO] Starting\n[DEBUG] Trace\nRunning tests\nInstalling deps\nTypeError: div by zero';
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.RUNTIME);
            expect(result.rootCauseLog).toBe('TypeError: div by zero');
        });

        it('should accumulate affected files for the same category', () => {
            const logs = 'ModuleNotFoundError: No module named "a"\nModuleNotFoundError: No module named "b"';
            const result = classifyError(logs);
            expect(result.affectedFiles).toContain('a');
            expect(result.affectedFiles).toContain('b');
        });

        it('should switch to better confidence for same priority', () => {
            const logs = 'ECONNREFUSED\nno space left on device';
            // Both are Priority 1.
            // ECONNREFUSED (Network) has confidence 0.9.
            // no space left (Disk Space) has confidence 0.95.
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.DISK_SPACE);
            expect(result.confidence).toBe(0.95);
        });

        it('should use first error-like line if no pattern matches', () => {
            const logs = 'Something went wrong\nSome generic exception occurred';
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.UNKNOWN);
            expect(result.rootCauseLog).toBe('Some generic exception occurred');
        });

        it('should detect mass failures as environment unstable', () => {
            const logs = '10 failing\n15 failed';
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.ENVIRONMENT_UNSTABLE);
        });
    });

    describe('isCascadingError', () => {
        const rootErr = {
            category: ErrorCategory.DEPENDENCY,
            affectedFiles: ['pkg.json'],
            timestamp: '2025-01-01T10:00:00',
            cascadingErrors: []
        } as any;

        it('should return false if cascade occurred before or at same time as root', () => {
            const earlyErr = { ...rootErr, timestamp: '2025-01-01T09:00:00' };
            expect(isCascadingError(earlyErr, rootErr)).toBe(false);
        });

        it('should return false for always-root categories', () => {
            const diskErr = { category: ErrorCategory.DISK_SPACE, affectedFiles: ['f.ts'], timestamp: '2025-01-01T11:00:00' } as any;
            expect(isCascadingError(diskErr, rootErr)).toBe(false);
        });

        it('should identify related errors by shared affected files', () => {
            const sharedErr = { category: ErrorCategory.BUILD, affectedFiles: ['pkg.json'], timestamp: '2025-01-01T11:00:00' } as any;
            expect(isCascadingError(sharedErr, rootErr)).toBe(true);
        });

        it('should identify build errors as cascading from syntax errors', () => {
            const syntaxRoot = { category: ErrorCategory.SYNTAX, affectedFiles: ['app.ts'], timestamp: '2025-01-01T10:00:00' } as any;
            const buildErr = { category: ErrorCategory.BUILD, affectedFiles: ['other.ts'], timestamp: '2025-01-01T11:00:00' } as any;
            expect(isCascadingError(buildErr, syntaxRoot)).toBe(true);
        });
    });

    describe('classifyErrorWithHistory', () => {
        it('should include related files from profile relationships', async () => {
            const profile = {
                fileRelationships: new Map([
                    ['app.ts', { dependencies: ['utils.ts'], testFiles: ['app.test.ts'] }]
                ])
            };
            const logs = 'TypeError: fail at (app.ts:10:5)';
            const result = await classifyErrorWithHistory(logs, profile);
            expect(result.relatedFiles).toContain('utils.ts');
            expect(result.relatedFiles).toContain('app.test.ts');
        });

        it('should handle knowledge base lookup failure gracefully', async () => {
            // Force dynamic import failure or mock findSimilarFixes to throw
            // Since it is a dynamic import, we can mock the whole services/knowledge-base.js
            vi.mock('../services/knowledge-base.js', () => {
                throw new Error('KB Offline');
            });
            
            const result = await classifyErrorWithHistory('TypeError: fail');
            expect(result.category).toBe(ErrorCategory.RUNTIME);
            expect(result.historicalMatches).toBeUndefined();
        });
    });
});
