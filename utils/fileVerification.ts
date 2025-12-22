import { glob } from 'tinyglobby';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FileVerificationResult {
    found: boolean;
    path?: string;
    matches: string[];
}

/**
 * Searches for a unique file in the project that matches the given filename.
 * Respects common ignore patterns.
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
}
