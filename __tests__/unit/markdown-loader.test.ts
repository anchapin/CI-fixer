import { describe, it, expect } from 'vitest';
import {
    parseRunbookFrontmatter,
    loadRunbook,
    searchRunbooks,
    loadAllRunbooks
} from '../../services/knowledge-base/markdown-loader.js';

describe('Markdown Runbook Loader', () => {
    describe('parseRunbookFrontmatter', () => {
        it('should parse YAML frontmatter correctly', () => {
            const content = `---
category: "typescript_error"
priority: "high"
success_count: 12
last_updated: "2025-12-13"
fingerprint: "abc123"
tags: ["module", "import"]
---

# Fix Title

## Diagnosis
Error description
`;

            const { metadata, body } = parseRunbookFrontmatter(content);

            expect(metadata.category).toBe('typescript_error');
            expect(metadata.priority).toBe('high');
            expect(metadata.success_count).toBe(12);
            expect(metadata.fingerprint).toBe('abc123');
            expect(metadata.tags).toEqual(['module', 'import']);
            expect(body).toContain('# Fix Title');
        });

        it('should throw error for missing frontmatter', () => {
            const content = '# Just a title\n\nNo frontmatter here';

            expect(() => parseRunbookFrontmatter(content)).toThrow('missing frontmatter');
        });
    });

    describe('loadRunbook', () => {
        it('should load TypeScript module-not-found runbook', async () => {
            const runbook = await loadRunbook('typescript', 'module-not-found');

            expect(runbook.metadata.category).toBe('typescript_error');
            expect(runbook.metadata.priority).toBe('high');
            expect(runbook.title).toContain('Module Not Found');
            expect(runbook.diagnosis).toContain('TypeScript cannot resolve');
            expect(runbook.solution).toContain('package.json');
        });

        it('should load Docker disk-space runbook', async () => {
            const runbook = await loadRunbook('docker', 'disk-space');

            expect(runbook.metadata.category).toBe('docker_error');
            expect(runbook.metadata.priority).toBe('critical');
            expect(runbook.diagnosis).toContain('disk space');
        });

        it('should throw error for non-existent runbook', async () => {
            await expect(loadRunbook('typescript', 'non-existent')).rejects.toThrow();
        });
    });

    describe('searchRunbooks', () => {
        it('should find runbooks by category', async () => {
            const results = await searchRunbooks({ category: 'typescript_error' });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].metadata.category).toBe('typescript_error');
        });

        it('should find runbooks by tags', async () => {
            const results = await searchRunbooks({ tags: ['docker'] });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].metadata.tags).toContain('docker');
        });

        it('should find runbooks by fingerprint', async () => {
            const results = await searchRunbooks({ fingerprint: 'ts_module_not_found' });

            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results.some(r => r.metadata.fingerprint === 'ts_module_not_found')).toBe(true);
        });

        it('should return empty array for no matches', async () => {
            const results = await searchRunbooks({ category: 'non_existent_category' });

            expect(results).toEqual([]);
        });
    });

    describe('loadAllRunbooks', () => {
        it('should load all runbooks from all categories', async () => {
            const runbooks = await loadAllRunbooks();

            expect(runbooks.length).toBeGreaterThanOrEqual(3); // We created 3 runbooks

            const categories = runbooks.map(r => r.metadata.category);
            expect(categories).toContain('typescript_error');
            expect(categories).toContain('docker_error');
            expect(categories).toContain('ci_configuration');
        });
    });
});
