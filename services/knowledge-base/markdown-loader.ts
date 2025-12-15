import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RunbookMetadata {
    category: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    success_count: number;
    last_updated: string;
    fingerprint: string;
    tags: string[];
}

export interface RunbookPattern {
    metadata: RunbookMetadata;
    title: string;
    content: string;
    diagnosis: string;
    solution: string;
    codeTemplate?: string;
    filePath: string;
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

/**
 * Parses YAML frontmatter from Markdown content.
 * Expects format:
 * ---
 * key: value
 * ---
 * # Content
 */
export function parseRunbookFrontmatter(content: string): { metadata: RunbookMetadata; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
        throw new Error('Invalid runbook format: missing frontmatter');
    }

    const [, frontmatterText, body] = match;

    // Simple YAML parser (handles basic key: value pairs and arrays)
    const metadata: any = {};
    const lines = frontmatterText.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Handle arrays (tags: ["tag1", "tag2"])
        if (trimmed.includes('[')) {
            const [key, value] = trimmed.split(':').map(s => s.trim());
            try {
                metadata[key] = JSON.parse(value);
            } catch {
                metadata[key] = value;
            }
        } else {
            // Handle simple key: value
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmed.substring(0, colonIndex).trim();
                let value: any = trimmed.substring(colonIndex + 1).trim();

                // Remove quotes
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                // Parse numbers
                if (!isNaN(Number(value)) && value !== '') {
                    value = Number(value);
                }

                metadata[key] = value;
            }
        }
    }

    return { metadata: metadata as RunbookMetadata, body };
}

/**
 * Extracts specific sections from Markdown content.
 */
function extractSection(content: string, sectionTitle: string): string {
    const regex = new RegExp(`## ${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
}

// ============================================================================
// RUNBOOK LOADING
// ============================================================================

/**
 * Loads a single runbook from file.
 */
export async function loadRunbook(category: string, name: string): Promise<RunbookPattern> {
    const runbooksDir = path.join(__dirname, '../../runbooks');
    const filePath = path.join(runbooksDir, category, `${name}.md`);

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { metadata, body } = parseRunbookFrontmatter(content);

        // Extract title (first # heading)
        const titleMatch = body.match(/^# (.+)$/m);
        const title = titleMatch ? titleMatch[1] : name;

        return {
            metadata,
            title,
            content: body,
            diagnosis: extractSection(body, 'Diagnosis'),
            solution: extractSection(body, 'Solution'),
            codeTemplate: extractSection(body, 'Code Template'),
            filePath
        };
    } catch (error: any) {
        throw new Error(`Failed to load runbook ${category}/${name}: ${error.message}`);
    }
}

/**
 * Loads all runbooks from a category directory.
 */
export async function loadRunbooksByCategory(category: string): Promise<RunbookPattern[]> {
    const runbooksDir = path.join(__dirname, '../../runbooks');
    const categoryDir = path.join(runbooksDir, category);

    try {
        const files = await fs.readdir(categoryDir);
        const runbooks: RunbookPattern[] = [];

        for (const file of files) {
            if (file.endsWith('.md') && file !== 'README.md') {
                const name = file.replace('.md', '');
                try {
                    const runbook = await loadRunbook(category, name);
                    runbooks.push(runbook);
                } catch (error) {
                    console.warn(`Failed to load runbook ${category}/${name}:`, error);
                }
            }
        }

        return runbooks;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return []; // Category directory doesn't exist
        }
        throw error;
    }
}

/**
 * Loads all runbooks from all categories.
 */
export async function loadAllRunbooks(): Promise<RunbookPattern[]> {
    const runbooksDir = path.join(__dirname, '../../runbooks');

    try {
        const entries = await fs.readdir(runbooksDir, { withFileTypes: true });
        const categories = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);

        const allRunbooks: RunbookPattern[] = [];

        for (const category of categories) {
            const runbooks = await loadRunbooksByCategory(category);
            allRunbooks.push(...runbooks);
        }

        return allRunbooks;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return []; // Runbooks directory doesn't exist
        }
        throw error;
    }
}

// ============================================================================
// RUNBOOK SEARCH
// ============================================================================

/**
 * Searches runbooks by category and tags.
 */
export async function searchRunbooks(query: {
    category?: string;
    tags?: string[];
    fingerprint?: string;
}): Promise<RunbookPattern[]> {
    const allRunbooks = await loadAllRunbooks();

    return allRunbooks.filter(runbook => {
        // Exact fingerprint match
        if (query.fingerprint && runbook.metadata.fingerprint === query.fingerprint) {
            return true;
        }

        // Category match
        if (query.category && runbook.metadata.category !== query.category) {
            return false;
        }

        // Tag match (at least one tag must match)
        if (query.tags && query.tags.length > 0) {
            const hasMatchingTag = query.tags.some(tag =>
                runbook.metadata.tags.includes(tag)
            );
            if (!hasMatchingTag) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Searches runbooks by text content (full-text search).
 */
export async function searchRunbooksByText(searchText: string): Promise<RunbookPattern[]> {
    const allRunbooks = await loadAllRunbooks();
    const lowerSearch = searchText.toLowerCase();

    return allRunbooks.filter(runbook => {
        const searchableText = [
            runbook.title,
            runbook.diagnosis,
            runbook.solution,
            runbook.metadata.tags.join(' ')
        ].join(' ').toLowerCase();

        return searchableText.includes(lowerSearch);
    });
}

// ============================================================================
// DATABASE SYNC
// ============================================================================

/**
 * Syncs a runbook to the database (for backward compatibility).
 */
export async function syncRunbookToDatabase(runbook: RunbookPattern): Promise<void> {
    const { db } = await import('../../db/client.js');

    try {
        const existing = await db.fixPattern.findFirst({
            where: {
                errorFingerprint: runbook.metadata.fingerprint,
                errorCategory: runbook.metadata.category
            }
        });

        const fixTemplate = {
            action: 'edit',
            solution: runbook.solution,
            codeTemplate: runbook.codeTemplate
        };

        if (existing) {
            await db.fixPattern.update({
                where: { id: existing.id },
                data: {
                    fixTemplate: JSON.stringify(fixTemplate),
                    successCount: runbook.metadata.success_count,
                    lastUsed: new Date(runbook.metadata.last_updated)
                }
            });
        } else {
            await db.fixPattern.create({
                data: {
                    errorFingerprint: runbook.metadata.fingerprint,
                    errorCategory: runbook.metadata.category,
                    filePath: 'runbook',
                    fixTemplate: JSON.stringify(fixTemplate),
                    successCount: runbook.metadata.success_count
                }
            });
        }
    } catch (error) {
        console.warn(`Failed to sync runbook to database:`, error);
    }
}

/**
 * Syncs all runbooks to the database.
 */
export async function syncAllRunbooksToDatabase(): Promise<void> {
    const runbooks = await loadAllRunbooks();

    for (const runbook of runbooks) {
        await syncRunbookToDatabase(runbook);
    }

    console.log(`Synced ${runbooks.length} runbooks to database`);
}
