import * as fs from 'fs';
import * as path from 'path';
import Fuse from 'fuse.js';

/**
 * Result of a path validation operation.
 */
export interface PathValidationResult {
    valid: boolean;
    exists: boolean;
    absolutePath: string;
    closestParent?: string;
    suggestions?: string[];
}

/**
 * Validates a path, checking for existence and providing suggestions if it doesn't exist.
 * 
 * @param targetPath The path to validate
 * @returns PathValidationResult
 */
export function validatePath(targetPath: string): PathValidationResult {
    const absolutePath = path.resolve(targetPath);
    const exists = fs.existsSync(absolutePath);

    if (exists) {
        return {
            valid: true,
            exists: true,
            absolutePath
        };
    }

    // Path doesn't exist, find closest parent and suggestions
    const closestParent = findClosestExistingParent(absolutePath);
    const suggestions = fuzzyMatchPath(targetPath);

    return {
        valid: false,
        exists: false,
        absolutePath,
        closestParent,
        suggestions
    };
}

/**
 * Attempts to find similar existing paths to the target path.
 * 
 * @param targetPath The hallucinated path
 * @returns Array of suggested existing paths
 */
export function fuzzyMatchPath(targetPath: string): string[] {
    const filename = path.basename(targetPath);
    const dirname = path.dirname(targetPath);
    const closestParent = findClosestExistingParent(targetPath);

    // If the directory doesn't exist, we look in the closest parent
    const searchDir = fs.existsSync(dirname) ? dirname : closestParent;
    
    try {
        const files = fs.readdirSync(searchDir, { recursive: true }) as string[];
        
        if (!files || !Array.isArray(files)) {
            return [];
        }

        const fuse = new Fuse(files, {
            includeScore: true,
            threshold: 0.4
        });

        const results = fuse.search(filename);
        return results.map(r => path.join(searchDir, r.item)).slice(0, 3);
    } catch (error) {
        return [];
    }
}

/**
 * Finds the closest existing parent directory for a given path.
 * Useful for diagnosing path hallucinations.
 * 
 * @param targetPath The path to validate
 * @returns The absolute path of the closest existing parent
 */
export function findClosestExistingParent(targetPath: string): string {
    let currentPath = path.resolve(targetPath);
    
    while (currentPath !== path.parse(currentPath).root) {
        if (fs.existsSync(currentPath)) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    
    return path.parse(currentPath).root;
}

/**
 * Extracts potential file paths from a command string.
 * 
 * Heuristics used:
 * - Strings containing slashes (/ or \)
 * - Strings with common file extensions (e.g., .ts, .js, .py, .json, .txt)
 * - Strings in quotes that look like paths
 * 
 * @param command The shell command string to analyze
 * @returns Array of unique potential file paths found in the command
 */
export function extractPaths(command: string): string[] {
    const paths = new Set<string>();
    
    // Regex for quoted strings (handles spaces in paths)
    const quotedRegex = /["']([^"']+)["']/g;
    let match;
    while ((match = quotedRegex.exec(command)) !== null) {
        const potentialPath = match[1];
        if (isPotentialPath(potentialPath)) {
            paths.add(potentialPath);
        }
    }

    // Regex for unquoted tokens
    // Split by whitespace but ignore what's inside quotes
    const unquotedTokens = command.replace(/["'][^"']+["']/g, '').split(/\s+/);
    
    for (const token of unquotedTokens) {
        if (!token || token.startsWith('-')) continue; // Skip flags
        if (isPotentialPath(token)) {
            paths.add(token);
        }
    }

    return Array.from(paths);
}

/**
 * Checks if a string looks like a file path.
 */
function isPotentialPath(str: string): boolean {
    // Contains path separators
    if (str.includes('/') || str.includes('\\')) {
        return true;
    }

    // Has a common file extension (at least 2 chars after the dot)
    const extensionRegex = /\.[a-z0-9]{2,5}$/i;
    if (extensionRegex.test(str)) {
        // Exclude common non-path things that might match, like domain names if any
        // But for a shell command, dots usually mean files or hidden files
        return true;
    }

    // Starts with ./ or ../ (already covered by includes slash, but for completeness)
    if (str.startsWith('./') || str.startsWith('../') || str.startsWith('.\\') || str.startsWith('..\\')) {
        return true;
    }

    return false;
}
