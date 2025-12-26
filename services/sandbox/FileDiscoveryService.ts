import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';
import Fuse from 'fuse.js';
import { glob } from 'tinyglobby';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FileVerificationResult {
    found: boolean;
    path?: string;
    relativePath?: string;  // Always provided relative to workspace root
    matches: string[];
    relativeMatches?: string[];  // Matches as relative paths
    depth?: number;  // Directory depth for context (0 = root, 1 = root/..., etc.)
}

/**
 * Enhanced file discovery service that always provides relative paths from workspace root.
 * This helps the LLM understand the directory structure without getting confused about nesting levels.
 */
export class FileDiscoveryService {

    /**
     * Searches for a unique file in the project that matches the given filename.
     * Respects common ignore patterns.
     * ALWAYS returns relative paths from workspace root for LLM clarity.
     */
    async findUniqueFile(filename: string, rootDir: string): Promise<FileVerificationResult> {
        const absolutePath = path.isAbsolute(filename) ? filename : path.resolve(rootDir, filename);

        // Helper function to calculate depth
        const calculateDepth = (filePath: string): number => {
            const relPath = path.relative(rootDir, filePath);
            if (relPath === '.' || relPath === filePath) return 0;
            return relPath.split(path.sep).filter(p => p !== '..' && p !== '').length;
        };

        // 1. Check if the file exists exactly where specified
        if (fs.existsSync(absolutePath)) {
            // Only return if it's a file, not a directory
            const stats = fs.statSync(absolutePath);
            if (stats.isFile()) {
                const relativePath = path.relative(rootDir, absolutePath);
                return {
                    found: true,
                    path: absolutePath,
                    relativePath,
                    matches: [absolutePath],
                    relativeMatches: [relativePath],
                    depth: calculateDepth(absolutePath)
                };
            }
        }

        // 2. Search for the filename project-wide
        const basename = path.basename(filename);

        // We search for the filename anywhere in the tree
        const pattern = `**/${basename}`;

        const matches = (await glob(pattern, {
            cwd: rootDir,
            absolute: true,
            ignore: [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/coverage/**',
                '**/.next/**',
                '**/.cache/**',
                '**/package-lock.json',
                '**/yarn.lock',
                '**/pnpm-lock.yaml'
            ]
        })).map(p => path.normalize(p));

        const relativeMatches = matches.map(m => path.relative(rootDir, m));

        if (matches.length === 1) {
            return {
                found: true,
                path: matches[0],
                relativePath: relativeMatches[0],
                matches,
                relativeMatches,
                depth: calculateDepth(matches[0])
            };
        }

        // If no matches or multiple matches, still return relative paths for context
        return {
            found: false,
            matches,
            relativeMatches
        };
    }

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
