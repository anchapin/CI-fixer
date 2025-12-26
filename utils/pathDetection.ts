import * as fs from 'fs';
import * as path from 'path';

/**
 * Utility to extract potential file paths from a shell command string.
 * Uses regex-based heuristics to identify strings that look like paths.
 */

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
