import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSuggestedActions, addActionTemplate, recordActionUsage } from '../../services/action-library.js';
import { ErrorCategory } from '../../errorClassification.js';
import { setupInMemoryDb, getTestDb, clearTestData } from '../helpers/vitest-setup.js';

// Use real test database (no auto-seeding)
// The DATABASE_URL env var will be set by setupInMemoryDb()
setupInMemoryDb();

describe('Action Library', () => {
    beforeEach(async () => {
        // Clear data between tests for isolation
        await clearTestData();
        const db = getTestDb();

        // Seed with test data for each test
        await db.actionTemplate.create({
            data: {
                errorCategory: 'syntax',
                filePattern: '*.ts',
                actionType: 'fix_syntax',
                template: 'Fix TypeScript error',
                frequency: 10,
                successRate: 0.8
            }
        });

        await db.actionTemplate.create({
            data: {
                errorCategory: 'dependency',
                filePattern: 'package.json',
                actionType: 'install_deps',
                template: 'npm install',
                frequency: 20,
                successRate: 1.0
            }
        });

        await db.actionTemplate.create({
            data: {
                errorCategory: 'test_failure',
                filePattern: '*.test.ts',
                actionType: 'fix_assertion',
                template: 'Fix assertion',
                frequency: 10,
                successRate: 0.9
            }
        });
    });

    describe('getSuggestedActions', () => {
        it('should return empty array when no templates match', async () => {
            const classified = {
                category: 'nonexistent_category' as ErrorCategory,
                confidence: 0.9,
                rootCauseLog: 'TypeError',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'TypeError',
                suggestedAction: ''
            };

            const suggestions = await getSuggestedActions(classified, 'app.ts', 3);

            expect(suggestions).toEqual([]);
        });

        it('should filter templates by file pattern match', async () => {
            const db = getTestDb();

            // Add JavaScript template
            await db.actionTemplate.create({
                data: {
                    errorCategory: 'syntax',
                    filePattern: '*.js',
                    actionType: 'fix_syntax_js',
                    template: 'Fix JavaScript error',
                    frequency: 5,
                    successRate: 0.9
                }
            });

            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Error',
                cascadingErrors: [],
                affectedFiles: ['src/app.ts'],
                errorMessage: 'Syntax error',
                suggestedAction: ''
            };

            const suggestions = await getSuggestedActions(classified, 'src/app.ts', 3);

            // Should only match *.ts pattern, not *.js
            expect(suggestions).toHaveLength(1);
            expect(suggestions[0].template.filePattern).toBe('*.ts');
        });

        it('should calculate confidence correctly', async () => {
            const classified = {
                category: ErrorCategory.DEPENDENCY,
                confidence: 0.9,
                rootCauseLog: 'Module not found',
                cascadingErrors: [],
                affectedFiles: ['package.json'],
                errorMessage: 'Cannot find module',
                suggestedAction: ''
            };

            const suggestions = await getSuggestedActions(classified, 'package.json', 1);

            // Confidence = (successRate * 0.7) + (min(frequency/10, 1.0) * 0.3)
            // = (1.0 * 0.7) + (min(20/10, 1.0) * 0.3) = 0.7 + 0.3 = 1.0
            expect(suggestions[0].confidence).toBeCloseTo(1.0, 2);
        });

        it('should rank by confidence descending', async () => {
            const db = getTestDb();

            // Add a low-confidence template
            await db.actionTemplate.create({
                data: {
                    errorCategory: 'test_failure',
                    filePattern: '*.test.ts',
                    actionType: 'update_test',
                    template: 'Update test',
                    frequency: 2,
                    successRate: 0.5
                }
            });

            const classified = {
                category: ErrorCategory.TEST_FAILURE,
                confidence: 0.8,
                rootCauseLog: 'Test failed',
                cascadingErrors: [],
                affectedFiles: ['app.test.ts'],
                errorMessage: 'Expected X but got Y',
                suggestedAction: ''
            };

            const suggestions = await getSuggestedActions(classified, 'app.test.ts', 3);

            expect(suggestions.length).toBeGreaterThanOrEqual(2);
            // Higher confidence should be first
            expect(suggestions[0].template.actionType).toBe('fix_assertion');
            expect(suggestions[0].confidence).toBeGreaterThan(suggestions[1].confidence);
        });

        it('should respect limit parameter', async () => {
            const db = getTestDb();

            // Add many templates
            for (let i = 0; i < 10; i++) {
                await db.actionTemplate.create({
                    data: {
                        errorCategory: 'syntax',
                        filePattern: '*.ts',
                        actionType: `action_${i}`,
                        template: `Template ${i}`,
                        frequency: i,
                        successRate: 0.5
                    }
                });
            }

            const classified = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'Error',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'Error',
                suggestedAction: ''
            };

            const suggestions = await getSuggestedActions(classified, 'app.ts', 3);

            expect(suggestions.length).toBeLessThanOrEqual(3);
        });

        it('should include reasoning in suggestions', async () => {
            const db = getTestDb();

            await db.actionTemplate.create({
                data: {
                    errorCategory: 'runtime',
                    filePattern: '*.ts',
                    actionType: 'add_null_check',
                    template: 'Add null checks',
                    frequency: 5,
                    successRate: 0.7
                }
            });

            const classified = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.9,
                rootCauseLog: 'Cannot read property',
                cascadingErrors: [],
                affectedFiles: ['app.ts'],
                errorMessage: 'TypeError',
                suggestedAction: ''
            };

            const suggestions = await getSuggestedActions(classified, 'app.ts', 1);

            expect(suggestions[0].reasoning).toContain('5 time(s)');
            expect(suggestions[0].reasoning).toContain('70%');
        });
    });

    describe('recordActionUsage', () => {
        it('should update existing template on success', async () => {
            const db = getTestDb();

            // Record a successful usage
            await recordActionUsage('syntax', '*.ts', 'fix_syntax', true);

            // Check the update
            const updated = await db.actionTemplate.findFirst({
                where: {
                    errorCategory: 'syntax',
                    filePattern: '*.ts',
                    actionType: 'fix_syntax'
                }
            });

            expect(updated).toBeDefined();
            expect(updated!.frequency).toBe(11); // Was 10, now 11
            // New success rate = ((0.8 * 10) + 1.0) / 11 = 8.8 / 11 ≈ 0.8
            expect(updated!.successRate).toBeCloseTo(0.8, 1);
        });

        it('should decrease success rate on failure', async () => {
            const db = getTestDb();

            // Record a failed usage
            await recordActionUsage('dependency', 'package.json', 'install_deps', false);

            // Check the update
            const updated = await db.actionTemplate.findFirst({
                where: {
                    errorCategory: 'dependency',
                    filePattern: 'package.json',
                    actionType: 'install_deps'
                }
            });

            expect(updated).toBeDefined();
            expect(updated!.frequency).toBe(21); // Was 20, now 21
            // New success rate = ((1.0 * 20) + 0.0) / 21 ≈ 0.952
            expect(updated!.successRate).toBeCloseTo(0.952, 2);
        });
    });

    describe('addActionTemplate', () => {
        it('should return existing template if already exists', async () => {
            const result = await addActionTemplate('syntax', '*.ts', 'fix_syntax', 'Fix it');

            expect(result.id).toBeDefined();
            expect(result.errorCategory).toBe('syntax');
        });

        it('should create new template if not exists', async () => {
            const db = getTestDb();

            const result = await addActionTemplate('build', '*.yml', 'fix_yaml', 'Fix YAML syntax');

            expect(result).toBeDefined();
            expect(result.errorCategory).toBe('build');
            expect(result.frequency).toBe(0);
            expect(result.successRate).toBe(0.0);

            // Verify it's in the database
            const found = await db.actionTemplate.findFirst({
                where: { errorCategory: 'build', filePattern: '*.yml' }
            });
            expect(found).toBeDefined();
        });
    });

    describe('getActionTemplates', () => {
        it('should return all templates when no category specified', async () => {
            const { getActionTemplates } = await import('../../services/action-library.js');
            const templates = await getActionTemplates();

            expect(templates.length).toBeGreaterThanOrEqual(3); // At least our seeded templates
        });

        it('should filter by error category', async () => {
            const { getActionTemplates } = await import('../../services/action-library.js');
            const templates = await getActionTemplates('syntax');

            expect(templates.length).toBeGreaterThan(0);
            templates.forEach(t => {
                expect(t.errorCategory).toBe('syntax');
            });
        });

        it('should order by frequency then success rate', async () => {
            const { getActionTemplates } = await import('../../services/action-library.js');
            const templates = await getActionTemplates();

            // Verify ordering
            for (let i = 0; i < templates.length - 1; i++) {
                const current = templates[i];
                const next = templates[i + 1];

                // Higher frequency should come first, or same frequency with higher success rate
                if (current.frequency === next.frequency) {
                    expect(current.successRate).toBeGreaterThanOrEqual(next.successRate);
                } else {
                    expect(current.frequency).toBeGreaterThanOrEqual(next.frequency);
                }
            }
        });
    });

    describe('seedActionLibrary', () => {
        it('should seed common action templates', async () => {
            const db = getTestDb();
            const { seedActionLibrary } = await import('../../services/action-library.js');

            // Clear existing templates
            await db.actionTemplate.deleteMany({});

            // Seed the library
            await seedActionLibrary();

            // Verify templates were created
            const templates = await db.actionTemplate.findMany({});
            expect(templates.length).toBeGreaterThan(0);

            // Verify some expected templates
            const depTemplate = templates.find(t =>
                t.errorCategory === 'dependency' && t.filePattern === 'package.json'
            );
            expect(depTemplate).toBeDefined();
            expect(depTemplate!.actionType).toBe('install_deps');

            const syntaxTemplate = templates.find(t =>
                t.errorCategory === 'syntax' && t.filePattern === '*.ts'
            );
            expect(syntaxTemplate).toBeDefined();
        });

        it('should not duplicate existing templates', async () => {
            const db = getTestDb();
            const { seedActionLibrary } = await import('../../services/action-library.js');

            // Seed once
            await seedActionLibrary();
            const countAfterFirst = await db.actionTemplate.count();

            // Seed again
            await seedActionLibrary();
            const countAfterSecond = await db.actionTemplate.count();

            // Count should be the same (no duplicates)
            expect(countAfterSecond).toBe(countAfterFirst);
        });
    });
});
