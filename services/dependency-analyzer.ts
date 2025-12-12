import { CodeFile } from '../types.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface DependencyGraph {
    nodes: Map<string, string[]>; // file -> dependencies
    reverse: Map<string, string[]>; // file -> dependents
}

export interface FileRelationship {
    source: string;
    dependencies: string[];
    dependents: string[];
    testFiles: string[];
}

// ============================================================================
// DEPENDENCY PARSING
// ============================================================================

/**
 * Parses import/require statements from a file to extract dependencies.
 * Supports TypeScript, JavaScript, and Python.
 */
export async function parseDependencies(
    filePath: string,
    content: string,
    language: string
): Promise<string[]> {
    const dependencies: string[] = [];
    const lines = content.split('\n');

    if (language === 'typescript' || language === 'javascript') {
        for (const line of lines) {
            // ES6 imports: import { x } from './file'
            const es6Match = line.match(/import\s+.*\s+from\s+['"](\.\.?\/[^'"]+)['"]/);
            if (es6Match) {
                dependencies.push(normalizeImportPath(es6Match[1], filePath));
            }

            // CommonJS: const x = require('./file')
            const cjsMatch = line.match(/require\(['"](\.\.?\/[^'"]+)['"]\)/);
            if (cjsMatch) {
                dependencies.push(normalizeImportPath(cjsMatch[1], filePath));
            }
        }
    } else if (language === 'python') {
        for (const line of lines) {
            // from .module import x
            const relativeMatch = line.match(/from\s+(\.+\w+)\s+import/);
            if (relativeMatch) {
                dependencies.push(normalizeImportPath(relativeMatch[1], filePath));
            }

            // import .module
            const importMatch = line.match(/import\s+(\.+\w+)/);
            if (importMatch) {
                dependencies.push(normalizeImportPath(importMatch[1], filePath));
            }
        }
    }

    return dependencies;
}

/**
 * Normalizes an import path relative to the importing file.
 * Handles ./ and ../ prefixes, and adds file extensions if missing.
 */
function normalizeImportPath(importPath: string, importerPath: string): string {
    // Remove .js, .ts extensions from import path
    let normalized = importPath.replace(/\.(js|ts)$/, '');

    // If it's a relative import, resolve it
    if (normalized.startsWith('./') || normalized.startsWith('../')) {
        const importerDir = importerPath.split('/').slice(0, -1);
        const importParts = normalized.split('/');

        for (const part of importParts) {
            if (part === '..') {
                importerDir.pop();
            } else if (part !== '.') {
                importerDir.push(part);
            }
        }

        normalized = importerDir.join('/');
    }

    // Add common extensions to try
    const possibleExtensions = ['.ts', '.js', '.tsx', '.jsx', '.py'];

    // Return the normalized path (caller will need to check which extension exists)
    return normalized;
}

// ============================================================================
// GRAPH BUILDING
// ============================================================================

/**
 * Builds a full dependency graph for a set of files.
 * Creates both forward (dependencies) and reverse (dependents) maps.
 */
export async function buildDependencyGraph(
    files: CodeFile[]
): Promise<DependencyGraph> {
    const nodes = new Map<string, string[]>();
    const reverse = new Map<string, string[]>();

    // Build forward graph
    for (const file of files) {
        const deps = await parseDependencies(file.name, file.content, file.language);

        // Filter to only include files that exist in our file list
        const validDeps = deps.filter(dep => {
            return files.some(f =>
                f.name === dep ||
                f.name === `${dep}.ts` ||
                f.name === `${dep}.js` ||
                f.name.startsWith(dep)
            );
        });

        nodes.set(file.name, validDeps);
    }

    // Build reverse graph
    for (const [file, deps] of nodes.entries()) {
        for (const dep of deps) {
            if (!reverse.has(dep)) {
                reverse.set(dep, []);
            }
            reverse.get(dep)!.push(file);
        }
    }

    return { nodes, reverse };
}

/**
 * Finds all files related to a given file, up to a maximum depth.
 * Includes both dependencies and dependents.
 */
export function getRelatedFiles(
    filePath: string,
    graph: DependencyGraph,
    maxDepth: number = 2
): string[] {
    const related = new Set<string>();
    const visited = new Set<string>();

    function traverse(file: string, depth: number, direction: 'forward' | 'backward') {
        if (depth > maxDepth || visited.has(file)) return;
        visited.add(file);

        if (file !== filePath) {
            related.add(file);
        }

        // Get next level files based on direction
        const nextFiles = direction === 'forward'
            ? (graph.nodes.get(file) || [])
            : (graph.reverse.get(file) || []);

        for (const nextFile of nextFiles) {
            traverse(nextFile, depth + 1, direction);
        }
    }

    // Traverse both forward (dependencies) and backward (dependents)
    traverse(filePath, 0, 'forward');
    visited.clear();
    traverse(filePath, 0, 'backward');

    return Array.from(related);
}

/**
 * Detects test files related to a source file.
 * Uses common naming patterns (.test.ts, .spec.ts, __tests__ directory).
 */
export function findTestFiles(
    sourceFile: string,
    allFiles: string[]
): string[] {
    const testFiles: string[] = [];
    const basename = sourceFile.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '') || '';
    const sourceDir = sourceFile.split('/').slice(0, -1).join('/');

    for (const file of allFiles) {
        const filename = file.split('/').pop() || '';

        // Check if it's a test file for this source
        if (
            filename.includes('.test.') ||
            filename.includes('.spec.') ||
            file.includes('__tests__')
        ) {
            // Check if the test file basename matches the source file
            if (filename.includes(basename)) {
                testFiles.push(file);
            }

            // Also check if test is in __tests__ directory parallel to source
            if (file.includes('__tests__') && file.includes(basename)) {
                testFiles.push(file);
            }
        }
    }

    return testFiles;
}

/**
 * Analyzes relationships for a specific file.
 */
export function analyzeFileRelationships(
    filePath: string,
    graph: DependencyGraph,
    allFiles: string[]
): FileRelationship {
    return {
        source: filePath,
        dependencies: graph.nodes.get(filePath) || [],
        dependents: graph.reverse.get(filePath) || [],
        testFiles: findTestFiles(filePath, allFiles)
    };
}
