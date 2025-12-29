/**
 * Path Resolution Enhancement Service
 * Phase 1, Task 1: Add absolute path conversion utility
 *
 * This service provides utilities for converting relative paths to absolute paths,
 * validating file existence, and integrating with findClosestFile to ensure
 * all file operations use verified absolute paths.
 */

import path from 'path';
import { AppConfig, CodeFile } from '../types.js';
import { findClosestFile } from './github/GitHubService.js';

/**
 * Converts a relative path to an absolute path based on the working directory.
 *
 * @param filePath - The file path (can be relative or absolute)
 * @param workingDir - The current working directory
 * @returns The absolute path
 * @throws Error if filePath is empty or undefined
 */
export function toAbsolutePath(filePath: string, workingDir: string): string {
    // Validate input
    if (!filePath || filePath.trim() === '') {
        throw new Error('Path Resolution Error: File path cannot be empty');
    }

    // If already absolute, normalize and return
    if (path.isAbsolute(filePath)) {
        return path.normalize(filePath);
    }

    // Convert relative to absolute
    const absolutePath = path.resolve(workingDir, filePath);

    // Normalize to remove any redundant components
    return path.normalize(absolutePath);
}

/**
 * Validates that a file exists and returns its absolute path.
 *
 * This function integrates with findClosestFile to locate the file
 * and then converts the result to an absolute path.
 *
 * @param filePath - The file path (can be relative or absolute)
 * @param workingDir - The current working directory
 * @param config - The app configuration
 * @param sandbox - Optional sandbox environment
 * @returns Object with absolute path and file content, or null if not found
 * @throws Error if file cannot be found
 */
export async function resolvePathWithValidation(
    filePath: string,
    workingDir: string,
    config: AppConfig,
    sandbox?: any
): Promise<{ file: CodeFile, path: string } | null> {
    try {
        // First, try to find the file using findClosestFile
        const result = await findClosestFile(config, filePath, sandbox);

        if (!result) {
            throw new Error(`Path Resolution Error: File '${filePath}' not found in repository or sandbox`);
        }

        // Convert to absolute path
        const absolutePath = toAbsolutePath(result.path, workingDir);

        // Return the result with the absolute path
        return {
            file: result.file,
            path: absolutePath
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Path Resolution Error: Failed to resolve '${filePath}': ${message}`);
    }
}

/**
 * Enhanced version of findClosestFile that always returns absolute paths.
 *
 * @param config - The app configuration
 * @param filePath - The file path to find
 * @param workingDir - The current working directory
 * @param sandbox - Optional sandbox environment
 * @returns Object with absolute path and file content, or null if not found
 */
export async function findClosestFileAbsolute(
    config: AppConfig,
    filePath: string,
    workingDir: string,
    sandbox?: any
): Promise<{ file: CodeFile, path: string } | null> {
    const result = await findClosestFile(config, filePath, sandbox);

    if (!result) {
        return null;
    }

    // Convert to absolute path
    const absolutePath = toAbsolutePath(result.path, workingDir);

    return {
        file: result.file,
        path: absolutePath
    };
}

/**
 * Validates that a path is absolute and properly formatted.
 *
 * @param filePath - The path to validate
 * @returns true if valid absolute path, false otherwise
 */
export function isValidAbsolutePath(filePath: string): boolean {
    if (!filePath || filePath.trim() === '') {
        return false;
    }

    return path.isAbsolute(filePath) && path.normalize(filePath) === filePath;
}
