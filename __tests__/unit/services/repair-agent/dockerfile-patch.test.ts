
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePatchCandidates } from '../../../../services/repair-agent/patch-generation.js';
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

describe('Dockerfile Patch Generation Constraints', () => {
    const mockConfig = {
        githubToken: 'test-token'
    };

    const mockFaultLocation = {
        file: 'Dockerfile',
        line: 5,
        confidence: 0.9,
        reasoning: 'Syntax error'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should remove inline comments in multi-line RUN commands', async () => {
        const badCode = `RUN apt-get update && \\\\
    apt-get install -y \\\\
    # This is a bad comment \\\\
    curl \\\\
    vim`;
        
        const expectedCode = `RUN apt-get update && \\\\
    apt-get install -y \\\\
    curl \\\\
    vim`;

        (unifiedGenerate as any).mockResolvedValue({
            text: JSON.stringify({
                code: badCode, 
                description: 'fix', 
                confidence: 0.9, 
                reasoning: 'r' 
            })
        });

        const result = await generatePatchCandidates(
            mockConfig as any,
            mockFaultLocation,
            'RUN something',
            'Error'
        );

        // We expect the implementation to have cleaned this up
        expect(result.primaryCandidate.code).not.toContain('# This is a bad comment');
        expect(result.primaryCandidate.code).toBe(expectedCode);
    });

    it('should fix common apt-get flag typos', async () => {
        const badCode = `RUN apt-get install -y --no-installfrrecommends curl`;
        const expectedCode = `RUN apt-get install -y --no-install-recommends curl`;

        (unifiedGenerate as any).mockResolvedValue({
            text: JSON.stringify({
                code: badCode, 
                description: 'fix', 
                confidence: 0.9, 
                reasoning: 'r' 
            })
        });

        const result = await generatePatchCandidates(
            mockConfig as any,
            mockFaultLocation,
            'RUN something',
            'Error'
        );

        expect(result.primaryCandidate.code).toContain('--no-install-recommends');
        expect(result.primaryCandidate.code).not.toContain('--no-installfrrecommends');
    });
});
