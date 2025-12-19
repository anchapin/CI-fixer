import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFix } from '../../services';
import { AppConfig } from '../../types';
import { unifiedGenerate } from '../../services/llm/LLMService';

// Mock unifiedGenerate directly
vi.mock('../../services/llm/LLMService', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as any),
        unifiedGenerate: vi.fn()
    };
});

describe('Code Generation Chunking', () => {
    const mockConfig: AppConfig = {
        repoUrl: 'owner/repo',
        githubToken: 'token',
        llmProvider: 'google',
        // @ts-expect-error - Testing invalid state
        devEnv: 'simulation'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should stitch code together when truncated', async () => {
        // Mock Response 1: Truncated (starts with fence, no end)
        vi.mocked(unifiedGenerate).mockResolvedValueOnce({
            text: '```typescript\nconst part1 = "start";\n// truncated here'
        });

        // Mock Response 2: Continuation (ends with fence)
        vi.mocked(unifiedGenerate).mockResolvedValueOnce({
            text: '```typescript\nconst part2 = "end";\n```'
        });

        const context = { error: "fix me", language: "typescript", code: "original code" };
        const result = await generateFix(mockConfig, context);

        expect(result).toContain('const part1 = "start";');
        expect(result).toContain('const part2 = "end";');
        expect(result).not.toContain('```'); // Fences should be gone
        expect(unifiedGenerate).toHaveBeenCalledTimes(2);
    });

    it('should handle single complete response', async () => {
        vi.mocked(unifiedGenerate).mockResolvedValueOnce({
            text: '```python\nprint("hello")\n```'
        });

        const context = { error: "fix me", language: "python", code: "original code" };
        const result = await generateFix(mockConfig, context);

        expect(result).toBe('print("hello")');
        expect(unifiedGenerate).toHaveBeenCalledTimes(1);
    });
});
