/**
 * Repository Preferences Manager
 * 
 * Manages user preferences for repository-specific behaviors
 */

import { CIFixerTool } from '../orchestration/tool-types.js';

export interface RepositoryPreferences {
    lintBeforeCommit: boolean;
    preferMinimalDiffs: boolean;
    modifyTests: boolean;
    addComments: boolean;
    maxDiffSize?: number;
    preferredTools?: CIFixerTool[];
    avoidTools?: CIFixerTool[];
}

export class PreferencesManager {
    private db: any;

    constructor(dbClient?: any) {
        this.db = dbClient;
    }

    /**
     * Get preferences for a repository
     */
    async getPreferences(repoUrl: string): Promise<RepositoryPreferences> {
        if (!this.db) {
            return this.getDefaults();
        }

        try {
            const prefs = await this.db.repositoryPreferences.findUnique({
                where: { repoUrl }
            });

            return prefs ? JSON.parse(prefs.preferences) : this.getDefaults();
        } catch (error) {
            console.warn('[PreferencesManager] Error loading preferences:', error);
            return this.getDefaults();
        }
    }

    /**
     * Update preferences for a repository
     */
    async updatePreferences(repoUrl: string, prefs: Partial<RepositoryPreferences>): Promise<void> {
        if (!this.db) {
            console.warn('[PreferencesManager] No database client, skipping preference update');
            return;
        }

        try {
            const existing = await this.getPreferences(repoUrl);
            const updated = { ...existing, ...prefs };

            await this.db.repositoryPreferences.upsert({
                where: { repoUrl },
                create: {
                    repoUrl,
                    preferences: JSON.stringify(updated)
                },
                update: {
                    preferences: JSON.stringify(updated)
                }
            });
        } catch (error) {
            console.error('[PreferencesManager] Error updating preferences:', error);
        }
    }

    /**
     * Get default preferences
     */
    private getDefaults(): RepositoryPreferences {
        return {
            lintBeforeCommit: true,
            preferMinimalDiffs: true,
            modifyTests: true,
            addComments: false
        };
    }
}
