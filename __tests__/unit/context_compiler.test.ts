
import { describe, it, expect, vi } from 'vitest';
import { filterLogs, summarizeLogs, getCachedRepoContext } from '../../services/context-compiler.js';

describe('ContextCompiler', () => {
    describe('filterLogs', () => {
        it('should extract error lines with context', () => {
            const logs = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n') +
                '\nError: Something went wrong\n' +
                Array.from({ length: 10 }, (_, i) => `Context After ${i}`).join('\n');

            const filtered = filterLogs(logs);
            expect(filtered).toContain('Error: Something went wrong');
            expect(filtered).toContain('Line 99'); // Context before
            expect(filtered).toContain('Context After 4'); // Context after
            expect(filtered).not.toContain('Line 50'); // Middle irrelevant
        });

        it('should include tail logs if no error found', () => {
            const logs = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n');
            const filtered = filterLogs(logs);
            expect(filtered).toContain('Line 99');
            expect(filtered.split('\n').length).toBeLessThanOrEqual(50);
        });
    });

    describe('summarizeLogs', () => {
        it('should extract exit code', async () => {
            const summary = await summarizeLogs("Process failed with Exit Code 123");
            expect(summary).toContain('Exit Code 123');
        });
    });

    describe('getCachedRepoContext', () => {
        it('should cache results', async () => {
            const generator = vi.fn().mockResolvedValue('Repo Context');
            const config = { repoUrl: 'test/repo' } as any;

            // First call
            const result1 = await getCachedRepoContext(config, 'sha1', generator);
            expect(result1).toBe('Repo Context');
            expect(generator).toHaveBeenCalledTimes(1);

            // Second call (should hit cache)
            const result2 = await getCachedRepoContext(config, 'sha1', generator);
            expect(result2).toBe('Repo Context');
            expect(generator).toHaveBeenCalledTimes(1); // Call count remains 1

            // Third call (new sha)
            const result3 = await getCachedRepoContext(config, 'sha2', generator);
            expect(result3).toBe('Repo Context');
            expect(generator).toHaveBeenCalledTimes(2);
        });
    });
});
