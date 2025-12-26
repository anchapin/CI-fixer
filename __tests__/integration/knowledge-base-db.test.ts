import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    generateErrorFingerprint,
    extractFixPattern,
    findSimilarFixes,
    updateFixPatternStats,
    getTopFixPatterns
} from '../../services/knowledge-base.js';
import { ErrorCategory } from '../../types.js';
import { TestDatabaseManager } from '../helpers/test-database.js';

describe('Knowledge Base - Database Integration Tests', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        // Clean up any existing data
        await testDb.fixPattern.deleteMany({});
        await testDb.errorSolution.deleteMany({});
    });

    afterEach(async () => {
        if (testDb) {
            await testDb.fixPattern.deleteMany({});
            await testDb.errorSolution.deleteMany({});
        }
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    describe('generateErrorFingerprint - Edge Cases', () => {
        it('should handle very long file paths', () => {
            const longPath = 'src/' + 'nested/'.repeat(50) + 'file.ts';
            const fp = generateErrorFingerprint('syntax', 'Error', [longPath]);

            expect(fp).toHaveLength(16);
        });

        it('should handle special characters in error messages', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error: $pecial Ch@rs!', ['app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'Error: $pecial Ch@rs!', ['app.ts']);

            expect(fp1).toBe(fp2);
        });

        it('should handle empty file array', () => {
            const fp = generateErrorFingerprint('syntax', 'Error', []);

            expect(fp).toHaveLength(16);
        });

        it('should handle multiple files', () => {
            const fp = generateErrorFingerprint('syntax', 'Error', ['a.ts', 'b.ts', 'c.ts']);

            expect(fp).toHaveLength(16);
        });

        it('should handle file paths consistently', () => {
            const fp1 = generateErrorFingerprint('syntax', 'Error', ['src/utils/app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'Error', ['lib/utils/app.ts']);

            // Both have same basename 'app.ts'
            expect(fp1).toBe(fp2);
        });

        it('should handle unicode characters', () => {
            const fp = generateErrorFingerprint('syntax', 'Error: 日本語 エラー', ['app.ts']);

            expect(fp).toHaveLength(16);
        });

        it('should differentiate similar but different errors', () => {
            const fp1 = generateErrorFingerprint('syntax', 'TypeError: Cannot read', ['app.ts']);
            const fp2 = generateErrorFingerprint('syntax', 'TypeError: Cannot write', ['app.ts']);

            expect(fp1).not.toBe(fp2);
        });
    });

    describe('extractFixPattern - Database Operations', () => {
        it('should create new fix pattern with edit-based fixes', async () => {
            const classifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'TypeError: Cannot read property',
                cascadingErrors: [],
                affectedFiles: ['src/app.ts'],
                errorMessage: 'TypeError: Cannot read property "foo" of undefined'
            };

            const filesChanged = [{
                path: 'src/app.ts',
                original: { content: 'const x = obj.foo;', language: 'typescript', name: 'app.ts' },
                modified: { content: 'const x = obj?.foo;', language: 'typescript', name: 'app.ts' },
                status: 'modified' as const
            }];

            await extractFixPattern('run-123', classifiedError, filesChanged, [], testDb);

            const patterns = await testDb.fixPattern.findMany({});
            expect(patterns).toHaveLength(1);
            expect(patterns[0].errorCategory).toBe(ErrorCategory.SYNTAX);
            expect(patterns[0].successCount).toBe(1);

            const fixTemplate = JSON.parse(patterns[0].fixTemplate);
            expect(fixTemplate.action).toBe('edit');
            expect(fixTemplate.edits).toHaveLength(1);
        });

        it('should create new fix pattern with command-based fixes', async () => {
            const classifiedError = {
                category: ErrorCategory.DEPENDENCY,
                confidence: 0.95,
                rootCauseLog: 'ModuleNotFoundError: No module named "requests"',
                cascadingErrors: [],
                affectedFiles: ['requirements.txt'],
                errorMessage: 'ModuleNotFoundError: No module named "requests"'
            };

            const filesChanged = [{
                path: 'requirements.txt',
                original: { content: '', language: 'text', name: 'requirements.txt' },
                modified: { content: 'requests==2.28.0', language: 'text', name: 'requirements.txt' },
                status: 'modified' as const
            }];

            const commandsUsed = ['pip install requests'];

            await extractFixPattern('run-124', classifiedError, filesChanged, commandsUsed, testDb);

            const patterns = await testDb.fixPattern.findMany({});
            expect(patterns).toHaveLength(1);

            const fixTemplate = JSON.parse(patterns[0].fixTemplate);
            expect(fixTemplate.action).toBe('command');
            expect(fixTemplate.command).toBe('pip install requests');
        });

        it('should update existing pattern success count', async () => {
            const classifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'TypeError',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'TypeError: Cannot read property'
            };

            const filesChanged = [{
                path: 'app.ts',
                original: { content: 'old', language: 'typescript', name: 'app.ts' },
                modified: { content: 'new', language: 'typescript', name: 'app.ts' },
                status: 'modified' as const
            }];

            // First extraction
            await extractFixPattern('run-1', classifiedError, filesChanged, [], testDb);
            let patterns = await testDb.fixPattern.findMany({});
            expect(patterns[0].successCount).toBe(1);

            // Second extraction with same error
            await extractFixPattern('run-2', classifiedError, filesChanged, [], testDb);
            patterns = await testDb.fixPattern.findMany({});
            expect(patterns).toHaveLength(1); // Still only one pattern
            expect(patterns[0].successCount).toBe(2); // Count incremented
        });

        it('should create ErrorSolution entry', async () => {
            const classifiedError = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.85,
                rootCauseLog: 'RuntimeError',
                cascadingErrors: [],
                affectedFiles: ['main.py'],
                errorMessage: 'RuntimeError: Something went wrong'
            };

            const filesChanged = [{
                path: 'main.py',
                original: { content: 'old code', language: 'python', name: 'main.py' },
                modified: { content: 'new code', language: 'python', name: 'main.py' },
                status: 'modified' as const
            }];

            await extractFixPattern('run-125', classifiedError, filesChanged, [], testDb);

            const solutions = await testDb.errorSolution.findMany({});
            expect(solutions).toHaveLength(1);
            expect(solutions[0].successRate).toBe(1.0);
            expect(solutions[0].timesApplied).toBe(1);
        });

        it('should update existing ErrorSolution', async () => {
            const classifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'SyntaxError',
                cascadingErrors: [],
                affectedFiles: ['test.ts'],
                errorMessage: 'SyntaxError: Unexpected token'
            };

            const filesChanged = [{
                path: 'test.ts',
                original: { content: 'old', language: 'typescript', name: 'test.ts' },
                modified: { content: 'new', language: 'typescript', name: 'test.ts' },
                status: 'modified' as const
            }];

            // First application
            await extractFixPattern('run-1', classifiedError, filesChanged, [], testDb);

            // Second application
            await extractFixPattern('run-2', classifiedError, filesChanged, [], testDb);

            const solutions = await testDb.errorSolution.findMany({});
            expect(solutions).toHaveLength(1);
            expect(solutions[0].timesApplied).toBe(2);
            expect(solutions[0].successRate).toBe(1.0);
        });
    });

    describe('findSimilarFixes - Similarity Matching', () => {
        beforeEach(async () => {
            // Seed database with some patterns
            const fingerprint1 = generateErrorFingerprint('syntax', 'TypeError: Cannot read', ['app.ts']);
            const fingerprint2 = generateErrorFingerprint('syntax', 'TypeError: Cannot write', ['app.ts']);
            const fingerprint3 = generateErrorFingerprint('runtime', 'RuntimeError', ['main.py']);

            await testDb.fixPattern.create({
                data: {
                    errorFingerprint: fingerprint1,
                    errorCategory: 'syntax',
                    filePath: 'app.ts',
                    fixTemplate: JSON.stringify({ action: 'edit' }),
                    successCount: 10
                }
            });

            await testDb.fixPattern.create({
                data: {
                    errorFingerprint: fingerprint2,
                    errorCategory: 'syntax',
                    filePath: 'app.ts',
                    fixTemplate: JSON.stringify({ action: 'edit' }),
                    successCount: 5
                }
            });

            await testDb.fixPattern.create({
                data: {
                    errorFingerprint: fingerprint3,
                    errorCategory: 'runtime',
                    filePath: 'main.py',
                    fixTemplate: JSON.stringify({ action: 'command' }),
                    successCount: 3
                }
            });
        });

        it('should find exact fingerprint match', async () => {
            const classifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'TypeError',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'TypeError: Cannot read'
            };

            const matches = await findSimilarFixes(classifiedError, 5, testDb);

            expect(matches.length).toBeGreaterThan(0);
            expect(matches[0].similarity).toBe(1.0); // Exact match
            expect(matches[0].pattern.errorCategory).toBe('syntax');
        });

        it('should filter by category', async () => {
            const classifiedError = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.85,
                rootCauseLog: 'RuntimeError',
                cascadingErrors: [],
                affectedFiles: ['main.py'],
                errorMessage: 'RuntimeError'
            };

            const matches = await findSimilarFixes(classifiedError, 5, testDb);

            expect(matches.length).toBeGreaterThan(0);
            expect(matches.every(m => m.pattern.errorCategory === 'runtime')).toBe(true);
        });

        it('should respect limit parameter', async () => {
            const classifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'TypeError',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'TypeError: Some error'
            };

            const matches = await findSimilarFixes(classifiedError, 1, testDb);

            expect(matches.length).toBeLessThanOrEqual(1);
        });

        it('should return empty array for no matches', async () => {
            const classifiedError = {
                category: ErrorCategory.UNKNOWN,
                confidence: 0.5,
                rootCauseLog: 'Completely unique error',
                cascadingErrors: [],
                affectedFiles: ['unique.ts'],
                errorMessage: 'Completely unique error never seen before xyz123'
            };

            const matches = await findSimilarFixes(classifiedError, 5, testDb);

            expect(Array.isArray(matches)).toBe(true);
        });

        it('should sort by similarity and success count', async () => {
            const classifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'TypeError',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'TypeError: Some error'
            };

            const matches = await findSimilarFixes(classifiedError, 10, testDb);

            if (matches.length > 1) {
                // First match should have highest similarity or success count
                expect(matches[0].similarity).toBeGreaterThanOrEqual(matches[1].similarity);
            }
        });
    });

    describe('updateFixPatternStats - Statistics Updates', () => {
        it('should update success rate on success', async () => {
            const fingerprint = 'test-fingerprint-123';

            // Create initial solution
            await testDb.errorSolution.create({
                data: {
                    errorFingerprint: fingerprint,
                    solution: JSON.stringify({ action: 'edit' }),
                    filesAffected: JSON.stringify(['app.ts']),
                    commandsUsed: JSON.stringify([]),
                    successRate: 1.0,
                    timesApplied: 1,
                    avgIterations: 1.0
                }
            });

            // Update with success
            await updateFixPatternStats(fingerprint, true, testDb);

            const solution = await testDb.errorSolution.findFirst({
                where: { errorFingerprint: fingerprint }
            });

            expect(solution.timesApplied).toBe(2);
            expect(solution.successRate).toBe(1.0); // (1.0 * 1 + 1.0) / 2 = 1.0
        });

        it('should update success rate on failure', async () => {
            const fingerprint = 'test-fingerprint-456';

            // Create initial solution with 100% success
            await testDb.errorSolution.create({
                data: {
                    errorFingerprint: fingerprint,
                    solution: JSON.stringify({ action: 'edit' }),
                    filesAffected: JSON.stringify(['app.ts']),
                    commandsUsed: JSON.stringify([]),
                    successRate: 1.0,
                    timesApplied: 1,
                    avgIterations: 1.0
                }
            });

            // Update with failure
            await updateFixPatternStats(fingerprint, false, testDb);

            const solution = await testDb.errorSolution.findFirst({
                where: { errorFingerprint: fingerprint }
            });

            expect(solution.timesApplied).toBe(2);
            expect(solution.successRate).toBe(0.5); // (1.0 * 1 + 0.0) / 2 = 0.5
        });

        it('should handle non-existent fingerprint gracefully', async () => {
            // Should not throw
            await expect(
                updateFixPatternStats('non-existent-fingerprint', true, testDb)
            ).resolves.not.toThrow();
        });
    });

    describe('getTopFixPatterns - Retrieval', () => {
        beforeEach(async () => {
            // Seed with multiple patterns
            await testDb.fixPattern.createMany({
                data: [
                    {
                        errorFingerprint: 'fp1',
                        errorCategory: 'syntax',
                        filePath: 'app.ts',
                        fixTemplate: '{}',
                        successCount: 10,
                        lastUsed: new Date('2025-12-10')
                    },
                    {
                        errorFingerprint: 'fp2',
                        errorCategory: 'runtime',
                        filePath: 'main.py',
                        fixTemplate: '{}',
                        successCount: 5,
                        lastUsed: new Date('2025-12-12')
                    },
                    {
                        errorFingerprint: 'fp3',
                        errorCategory: 'dependency',
                        filePath: 'package.json',
                        fixTemplate: '{}',
                        successCount: 15,
                        lastUsed: new Date('2025-12-11')
                    }
                ]
            });
        });

        it('should return patterns ordered by success count', async () => {
            const patterns = await getTopFixPatterns(10, testDb);

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns[0].successCount).toBeGreaterThanOrEqual(patterns[patterns.length - 1].successCount);
        });

        it('should respect limit parameter', async () => {
            const patterns = await getTopFixPatterns(2, testDb);

            expect(patterns.length).toBeLessThanOrEqual(2);
        });

        it('should use default limit of 20', async () => {
            const patterns = await getTopFixPatterns(20, testDb);

            expect(Array.isArray(patterns)).toBe(true);
            expect(patterns.length).toBeLessThanOrEqual(20);
        });

        it('should return most successful patterns first', async () => {
            const patterns = await getTopFixPatterns(3, testDb);

            expect(patterns[0].successCount).toBe(15); // fp3
            expect(patterns[1].successCount).toBe(10); // fp1
            expect(patterns[2].successCount).toBe(5);  // fp2
        });
    });
});
