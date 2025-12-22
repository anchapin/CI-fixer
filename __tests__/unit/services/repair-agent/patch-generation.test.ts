
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePatchCandidates, rankPatches, filterByConfidence, PatchCandidate } from '../../../../services/repair-agent/patch-generation.js';
import { unifiedGenerate } from '../../../../services/llm/LLMService.js';

// Mock LLM Service
vi.mock('../../../../services/llm/LLMService.js', () => ({
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn((text, fallback) => {
        try {
            return JSON.parse(text);
        } catch {
            return fallback;
        }
    })
}));

describe('Patch Generation Module', () => {
    const mockConfig = {
        githubToken: 'test-token',
        openaiApiKey: 'test-key',
        redisUrl: 'redis://localhost:6379',
        repoUrl: 'owner/repo'
    };

    const mockFaultLocation = {
        file: 'src/main.ts',
        line: 10,
        confidence: 0.9,
        reasoning: 'Null pointer likely'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generatePatchCandidates', () => {
        it('should generate candidates using all 3 strategies', async () => {
            // Mock responses for each strategy call (including backticks for validation)
            (unifiedGenerate as any)
                .mockResolvedValueOnce({ text: '```json\n' + JSON.stringify({ code: 'fix1', description: 'direct', confidence: 0.9, reasoning: 'r1' }) + '\n```' })
                .mockResolvedValueOnce({ text: '```json\n' + JSON.stringify({ code: 'fix2', description: 'conservative', confidence: 0.8, reasoning: 'r2' }) + '\n```' })
                .mockResolvedValueOnce({ text: '```json\n' + JSON.stringify({ code: 'fix3', description: 'alternative', confidence: 0.7, reasoning: 'r3' }) + '\n```' });

            const result = await generatePatchCandidates(
                mockConfig,
                mockFaultLocation,
                'const a = b;',
                'Error: b is undefined'
            );

            expect(result.candidates).toHaveLength(3);
            expect(result.candidates.map(c => c.strategy)).toEqual(expect.arrayContaining(['direct', 'conservative', 'alternative']));
            expect(unifiedGenerate).toHaveBeenCalledTimes(3);

            // Verify context
            expect(result.context.faultLocation).toEqual(mockFaultLocation);
            expect(result.primaryCandidate).toBeDefined();
        });

        it('should handle LLM failures gracefully (fallback to safeJsonParse default)', async () => {
            // Mock failures (invalid JSON returns)
            (unifiedGenerate as any).mockResolvedValue({ text: "Not JSON" });

            const result = await generatePatchCandidates(
                mockConfig,
                mockFaultLocation,
                'code',
                'error'
            );

            expect(result.candidates).toHaveLength(3);
            // safeJsonParse returns confidence 0.0 on failure
            expect(result.candidates[0].confidence).toBe(0);
        });
    });

    describe('rankPatches', () => {
        it('should rank primarily by confidence', () => {
            const candidates: PatchCandidate[] = [
                { id: '1', confidence: 0.5, strategy: 'direct' } as any,
                { id: '2', confidence: 0.9, strategy: 'alternative' } as any
            ];

            const ranked = rankPatches(candidates);
            expect(ranked[0].id).toBe('2'); // Higher confidence wins
        });

        it('should rank by strategy when confidence is similar (within 0.1)', () => {
            const candidates: PatchCandidate[] = [
                { id: '1', confidence: 0.85, strategy: 'alternative' } as any, // Score 1
                { id: '2', confidence: 0.80, strategy: 'direct' } as any      // Score 3
            ];

            const ranked = rankPatches(candidates);
            // Diff is 0.05 (< 0.1), so strategy score should win. 
            // Direct (3) > Alternative (1)
            expect(ranked[0].id).toBe('2');
        });
    });

    describe('filterByConfidence', () => {
        it('should filter out low confidence patches', () => {
            const candidates: PatchCandidate[] = [
                { id: '1', confidence: 0.9 } as any,
                { id: '2', confidence: 0.4 } as any
            ];

            const filtered = filterByConfidence(candidates, 0.5);
            expect(filtered).toHaveLength(1);
            expect(filtered[0].id).toBe('1');
        });
    });
});
