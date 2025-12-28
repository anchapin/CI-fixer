import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
    parseRunbookFrontmatter, 
    loadRunbook, 
    loadRunbooksByCategory, 
    loadAllRunbooks,
    searchRunbooks,
    syncRunbookToDatabase
} from '../../../../services/knowledge-base/markdown-loader';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

vi.mock('node:fs/promises');

describe('MarkdownLoader Enhanced', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('parseRunbookFrontmatter', () => {
        it('should handle comments and various formats in frontmatter', () => {
            const content = `---
category: test
# this is a comment
priority: 'high'
tags: invalid_json[
count: 10
empty: ""
---
# Title
Body`;
            const { metadata } = parseRunbookFrontmatter(content) as { metadata: any };
            expect(metadata.category).toBe('test');
            expect(metadata.priority).toBe('high');
            expect(metadata.count).toBe(10);
            expect(metadata.empty).toBe('');
            expect(metadata.tags).toBe('invalid_json[');
        });

        it('should throw error for missing frontmatter', () => {
            expect(() => parseRunbookFrontmatter('no frontmatter')).toThrow('Invalid runbook format');
        });
    });

    describe('loadRunbook', () => {
        it('should use filename as title if no # heading found', async () => {
            const content = `---
fingerprint: fp
---
No title here`;
            vi.mocked(fs.readFile).mockResolvedValue(content);
            
            const result = await loadRunbook('cat', 'name');
            expect(result.title).toBe('name');
        });

        it('should throw error on failure', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(new Error('read fail'));
            await expect(loadRunbook('cat', 'name')).rejects.toThrow('Failed to load runbook');
        });
    });

    describe('loadRunbooksByCategory', () => {
        it('should skip non-markdown and README.md files', async () => {
            vi.mocked(fs.readdir).mockResolvedValue(['test.md', 'README.md', 'other.txt'] as any);
            vi.mocked(fs.readFile).mockResolvedValue(`---
category: test
---
# Title`);

            const results = await loadRunbooksByCategory('test');
            expect(results).toHaveLength(1);
            expect(fs.readFile).toHaveBeenCalledTimes(1);
        });

        it('should handle individual load failures gracefully', async () => {
            vi.mocked(fs.readdir).mockResolvedValue(['fail.md', 'pass.md'] as any);
            vi.mocked(fs.readFile)
                .mockRejectedValueOnce(new Error('fail'))
                .mockResolvedValueOnce(`---
category: test
---
# Pass`);

            const results = await loadRunbooksByCategory('test');
            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Pass');
        });

        it('should rethrow non-ENOENT readdir errors', async () => {
            const error = new Error('Permission denied');
            (error as any).code = 'EACCES';
            vi.mocked(fs.readdir).mockRejectedValue(error);
            await expect(loadRunbooksByCategory('test')).rejects.toThrow('Permission denied');
        });
    });

    describe('loadAllRunbooks', () => {
        it('should return empty array if runbooks dir is missing', async () => {
            const error = new Error('No dir');
            (error as any).code = 'ENOENT';
            vi.mocked(fs.readdir).mockRejectedValue(error);
            const results = await loadAllRunbooks();
            expect(results).toEqual([]);
        });

        it('should rethrow non-ENOENT error', async () => {
            const error = new Error('Fail');
            (error as any).code = 'EACCES';
            vi.mocked(fs.readdir).mockRejectedValue(error);
            await expect(loadAllRunbooks()).rejects.toThrow('Fail');
        });
    });

    describe('searchRunbooks', () => {
        const mockRunbooks = [
            { metadata: { category: 'cat1', fingerprint: 'fp1', tags: ['t1'] }, title: 'T1' },
            { metadata: { category: 'cat2', fingerprint: 'fp2', tags: ['t2'] }, title: 'T2' }
        ];

        it('should filter by fingerprint', async () => {
            vi.mocked(fs.readdir).mockResolvedValue([{ name: 'cat1', isDirectory: () => true }] as any);
            // Mock subsequent calls... easier to mock loadAllRunbooks if it wasn't exported but it is.
            // Actually I'll just let it run and mock the fs calls it makes.
            vi.mocked(fs.readdir)
                .mockResolvedValueOnce([{ name: 'cat1', isDirectory: () => true }] as any) // loadAllRunbooks
                .mockResolvedValueOnce(['r1.md'] as any); // loadRunbooksByCategory
            vi.mocked(fs.readFile).mockResolvedValue(`---
category: cat1
fingerprint: fp1
tags: []
---
# T1`);

            const results = await searchRunbooks({ fingerprint: 'fp1' });
            expect(results).toHaveLength(1);
            expect(results[0].metadata.fingerprint).toBe('fp1');
        });

        it('should filter by category and tags', async () => {
            vi.mocked(fs.readdir).mockImplementation((path: any, options: any) => {
                if (options?.withFileTypes) {
                    return Promise.resolve([{ name: 'cat1', isDirectory: () => true }]) as any;
                }
                return Promise.resolve(['r1.md']) as any;
            });
            vi.mocked(fs.readFile).mockResolvedValue(`---
category: cat1
tags: ["t1"]
---
# T1`);

            // Category match, tag mismatch
            expect(await searchRunbooks({ category: 'cat1', tags: ['t2'] })).toHaveLength(0);
            
            // Category mismatch
            expect(await searchRunbooks({ category: 'cat2' })).toHaveLength(0);

            // Tag match
            expect(await searchRunbooks({ tags: ['t1'] })).toHaveLength(1);
        });
    });

    describe('syncRunbookToDatabase', () => {
        it('should handle errors gracefully', async () => {
            // This is tricky because it uses dynamic import for db
            // but we can try to mock console.warn
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            await syncRunbookToDatabase({ metadata: {} } as any);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to sync'), expect.anything());
        });
    });
});
