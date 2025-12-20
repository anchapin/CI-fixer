import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';
import Fuse from 'fuse.js';

export class FileDiscoveryService {

    /**
     * Recursively searches for a file by exact name.
     */
    async recursiveSearch(config: AppConfig, filename: string, sandbox: SandboxEnvironment): Promise<string | null> {
        try {
            // Use 'find' to locate the file
            const result = await sandbox.runCommand(`find . -name "${filename}" -not -path '*/.*'`);
            if (result.exitCode === 0 && result.stdout.trim()) {
                const lines = result.stdout.trim().split('\n');
                return lines[0].trim(); // Return first match
            }
        } catch (e) {
            console.warn(`[FileDiscovery] Recursive search failed: ${e}`);
        }
        return null;
    }

    /**
     * Uses fuzzy matching to find files with similar names.
     */
    async fuzzySearch(config: AppConfig, filename: string, sandbox: SandboxEnvironment): Promise<string | null> {
        try {
            // Get list of all files
            // For efficiency, maybe limit depth or exclude huge dirs
            const result = await sandbox.runCommand("find . -type f -not -path '*/.*' -maxdepth 5");
            if (result.exitCode !== 0) return null;

            const allFiles = result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
            
            // Map to objects with basename for better searching
            const fileList = allFiles.map(f => ({
                path: f,
                name: f.split('/').pop() || f
            }));

            const fuse = new Fuse(fileList, {
                keys: ['name'], // Search primarily on the filename
                includeScore: true,
                threshold: 0.6,
                ignoreLocation: true // Find match anywhere in string
            });

            // Search for the filename (ignoring path)
            const basename = filename.split('/').pop() || filename;
            const searchResults = fuse.search(basename);

            if (searchResults.length > 0) {
                return searchResults[0].item.path;
            }

            if (searchResults.length > 0) {
                return searchResults[0].item.path;
            }

            // Fallback: Simple includes check
            const simpleMatch = fileList.find(f => f.name.includes(basename) || basename.includes(f.name));
            if (simpleMatch) return simpleMatch.path;
        } catch (e) {
            console.warn(`[FileDiscovery] Fuzzy search failed: ${e}`);
        }
        return null;
    }

    /**
     * Checks git history to see if the file was renamed.
     */
    async checkGitHistoryForRename(config: AppConfig, filename: string, sandbox: SandboxEnvironment): Promise<string | null> {
        try {
            // git log --name-status --oneline | grep "filename"
            const result = await sandbox.runCommand(`git log --name-status --oneline | grep "${filename}"`);
            
            if (result.exitCode === 0) {
                const lines = result.stdout.split('\n');
                for (const line of lines) {
                    // Look for rename pattern: R100 oldname newname
                    if (line.includes(`\t${filename}\t`) || line.includes(`\t${filename}`)) {
                        const parts = line.split('\t');
                        if (parts[0].startsWith('R')) {
                             if (parts[1] === filename) return parts[2]; // Old matches, return New
                        }
                    }
                }
            }
        } catch (e) {
             console.warn(`[FileDiscovery] Git rename check failed: ${e}`);
        }
        return null;
    }

    /**
     * Checks git history to see if the file was deleted.
     */
    async checkGitHistoryForDeletion(config: AppConfig, filename: string, sandbox: SandboxEnvironment): Promise<boolean> {
         try {
            const result = await sandbox.runCommand(`git log -1 --diff-filter=D --summary -- "${filename}"`);
            // Check for 'delete mode' OR just the file status if name-status was used
            return result.exitCode === 0 && (result.stdout.includes(`delete mode`) || result.stdout.includes(`D\t${filename}`));
        } catch (e) {
             console.warn(`[FileDiscovery] Git deletion check failed: ${e}`);
        }
        return false;
    }
}
