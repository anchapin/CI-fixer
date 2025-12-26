import { glob } from 'tinyglobby';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import Fuse from 'fuse.js';

export interface FileVerificationResult {
    found: boolean;
    path?: string;
    matches: string[];
}

/**
 * Searches for a unique file in the project that matches the given filename.
 * Respects common ignore patterns and includes fuzzy matching.
 * 
 * @param filename The filename or path to search for.
 * @param rootDir The root directory to search within.
 * @returns A promise that resolves to a FileVerificationResult.
 */
export async function findUniqueFile(filename: string, rootDir: string): Promise<FileVerificationResult> {
    const absolutePath = path.isAbsolute(filename) ? filename : path.resolve(rootDir, filename);
    
    // 1. Check if the file exists exactly where specified
    if (fs.existsSync(absolutePath)) {
        // Only return if it's a file, not a directory
        const stats = fs.statSync(absolutePath);
        if (stats.isFile()) {
            return {
                found: true,
                path: absolutePath,
                matches: [absolutePath]
            };
        }
    }

    // 2. Search for the filename project-wide using glob
    const basename = path.basename(filename);
    const pattern = `**/${basename}`;
    
    const globMatches = (await glob(pattern, {
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

    if (globMatches.length === 1) {
        return {
            found: true,
            path: globMatches[0],
            matches: globMatches
        };
    }

    if (globMatches.length > 1) {
        return {
            found: false,
            matches: globMatches
        };
    }

    // 3. Fallback to Fuzzy Search across all tracked files
    return fuzzySearchFiles(filename, rootDir);
}

/**
 * Performs a fuzzy search for a filename across all tracked files in the project.
 */
async function fuzzySearchFiles(filename: string, rootDir: string): Promise<FileVerificationResult> {
    try {
        // Get all tracked files using git ls-files
        // This is much faster than globbing the whole disk for fuzzy matching
        const gitFilesOutput = execSync('git ls-files', { cwd: rootDir, encoding: 'utf-8' });
        const allFiles = gitFilesOutput.split('\n').filter(f => !!f);

        const fuse = new Fuse(allFiles, {
            includeScore: true,
            threshold: 0.4, // Adjust threshold for "fuzzy-ness"
            keys: [] // searching the array of strings directly
        });

        const results = fuse.search(filename);

        if (results.length === 0) {
            return { found: false, matches: [] };
        }

        // If we have a very strong match (score close to 0)
        if (results[0].score !== undefined && results[0].score < 0.1) {
            const bestMatch = path.resolve(rootDir, results[0].item);
            return {
                found: true,
                path: bestMatch,
                matches: [bestMatch]
            };
        }

        // If multiple candidates are found with reasonable scores
        const matches = results
            .filter(r => r.score !== undefined && r.score < 0.4)
            .map(r => path.resolve(rootDir, r.item));

        if (matches.length === 1) {
            return {
                found: true,
                path: matches[0],
                matches
            };
        }

        return {
            found: false,
            matches
        };
    } catch (error) {
        console.error('[FileVerification] Fuzzy search failed:', error);
        return { found: false, matches: [] };
    }
}