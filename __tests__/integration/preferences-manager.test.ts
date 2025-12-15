import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTestDatabase } from '../helpers/test-database.js';
import { PreferencesManager } from '../../services/preferences/repository-preferences.js';

describe('PreferencesManager Integration', () => {
    let testDb: InMemoryTestDatabase;
    let db: any;
    let manager: PreferencesManager;

    beforeEach(async () => {
        testDb = new InMemoryTestDatabase();
        db = await testDb.setup();
        manager = new PreferencesManager(db);
    });

    afterEach(async () => {
        await testDb.teardown();
    });

    describe('getPreferences', () => {
        it('should return defaults for new repository', async () => {
            const prefs = await manager.getPreferences('https://github.com/test/repo');

            expect(prefs.lintBeforeCommit).toBe(true);
            expect(prefs.preferMinimalDiffs).toBe(true);
            expect(prefs.modifyTests).toBe(true);
            expect(prefs.addComments).toBe(false);
        });

        it('should return stored preferences', async () => {
            await manager.updatePreferences('https://github.com/test/repo', {
                lintBeforeCommit: false,
                preferredTools: ['syntax_validator', 'linter']
            });

            const prefs = await manager.getPreferences('https://github.com/test/repo');

            expect(prefs.lintBeforeCommit).toBe(false);
            expect(prefs.preferredTools).toEqual(['syntax_validator', 'linter']);
        });
    });

    describe('updatePreferences', () => {
        it('should create new preferences', async () => {
            await manager.updatePreferences('https://github.com/test/new-repo', {
                maxDiffSize: 100,
                avoidTools: ['semantic_code_search']
            });

            const prefs = await manager.getPreferences('https://github.com/test/new-repo');

            expect(prefs.maxDiffSize).toBe(100);
            expect(prefs.avoidTools).toEqual(['semantic_code_search']);
        });

        it('should merge with existing preferences', async () => {
            await manager.updatePreferences('https://github.com/test/repo', {
                lintBeforeCommit: false
            });

            await manager.updatePreferences('https://github.com/test/repo', {
                preferMinimalDiffs: false
            });

            const prefs = await manager.getPreferences('https://github.com/test/repo');

            expect(prefs.lintBeforeCommit).toBe(false); // First update
            expect(prefs.preferMinimalDiffs).toBe(false); // Second update
            expect(prefs.modifyTests).toBe(true); // Default preserved
        });
    });
});
