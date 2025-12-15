
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreferencesManager } from '../../../../services/preferences/repository-preferences';

describe('PreferencesManager', () => {
    let mockDb: any;
    let manager: PreferencesManager;

    beforeEach(() => {
        mockDb = {
            repositoryPreferences: {
                findUnique: vi.fn(),
                upsert: vi.fn()
            }
        };
        manager = new PreferencesManager(mockDb);
    });

    describe('getPreferences', () => {
        it('should return defaults if no db client provided', async () => {
            const noDbManager = new PreferencesManager(undefined);
            const prefs = await noDbManager.getPreferences('owner/repo');
            expect(prefs.lintBeforeCommit).toBe(true);
        });

        it('should return defaults if not found in db', async () => {
            mockDb.repositoryPreferences.findUnique.mockResolvedValue(null);
            const prefs = await manager.getPreferences('owner/repo');
            expect(prefs.lintBeforeCommit).toBe(true);
            expect(mockDb.repositoryPreferences.findUnique).toHaveBeenCalledWith({ where: { repoUrl: 'owner/repo' } });
        });

        it('should return parsed preferences from db', async () => {
            const stored = {
                lintBeforeCommit: false,
                preferMinimalDiffs: false,
                modifyTests: true,
                addComments: true
            };
            mockDb.repositoryPreferences.findUnique.mockResolvedValue({
                preferences: JSON.stringify(stored)
            });

            const prefs = await manager.getPreferences('owner/repo');
            expect(prefs.lintBeforeCommit).toBe(false);
            expect(prefs.addComments).toBe(true);
        });

        it('should return defaults on error', async () => {
            mockDb.repositoryPreferences.findUnique.mockRejectedValue(new Error('DB Error'));
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            const prefs = await manager.getPreferences('owner/repo');
            expect(prefs.lintBeforeCommit).toBe(true);
            expect(consoleSpy).toHaveBeenCalled();
        });
    });

    describe('updatePreferences', () => {
        it('should skip if no db client', async () => {
            const noDbManager = new PreferencesManager(undefined);
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
            await noDbManager.updatePreferences('owner/repo', { lintBeforeCommit: false });
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No database client'));
        });

        it('should logic update (merge) preferences', async () => {
            // Setup existing
            mockDb.repositoryPreferences.findUnique.mockResolvedValue({
                preferences: JSON.stringify({
                    lintBeforeCommit: true,
                    preferMinimalDiffs: true
                })
            });

            await manager.updatePreferences('owner/repo', { lintBeforeCommit: false });

            expect(mockDb.repositoryPreferences.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { repoUrl: 'owner/repo' },
                create: expect.objectContaining({
                    repoUrl: 'owner/repo',
                    preferences: expect.stringContaining('"lintBeforeCommit":false')
                }),
                update: expect.objectContaining({
                    preferences: expect.stringContaining('"lintBeforeCommit":false')
                })
            }));

            // Check that it merged (preferMinimalDiffs should still be true)
            const callArgs = mockDb.repositoryPreferences.upsert.mock.calls[0][0];
            const saved = JSON.parse(callArgs.create.preferences);
            expect(saved.preferMinimalDiffs).toBe(true);
        });

        it('should handle errors gracefully', async () => {
            // Mock getPreferences to succeed (returns defaults if findUnique fails, but we want upsert to fail)
            mockDb.repositoryPreferences.findUnique.mockResolvedValue(null);

            // Mock upsert to fail
            mockDb.repositoryPreferences.upsert.mockRejectedValue(new Error('Upsert Fail'));

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            await manager.updatePreferences('owner/repo', {});
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error updating preferences'), expect.any(Error));
        });
    });
});
