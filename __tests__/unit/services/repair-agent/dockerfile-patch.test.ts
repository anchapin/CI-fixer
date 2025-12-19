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
        const badCode = `RUN apt-get update && \\
    apt-get install -y \\
    # This is a bad comment \\
    curl \\
    vim`;
        const expectedCode = `RUN apt-get update && \\
    apt-get install -y \\
    curl \\
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

        expect(result.primaryCandidate.code).not.toContain('# This is a bad comment');
        expect(result.primaryCandidate.code).toBe(expectedCode);
    });

    it('should fix various shell flag typos using the generic registry', async () => {
        const testCases = [
            // apt-get
            { bad: 'apt-get install --no-installfrrecommends', good: 'apt-get install --no-install-recommends' },
            { bad: 'apt-get install --no-installrecommends', good: 'apt-get install --no-install-recommends' },
            { bad: 'apt-get install --no-install-recommend', good: 'apt-get install --no-install-recommends' },
            // pip
            { bad: 'pip install --no-cache', good: 'pip install --no-cache-dir' },
            { bad: 'pip install --nocache-dir', good: 'pip install --no-cache-dir' },
            // npm
            { bad: 'npm install --noaudit', good: 'npm install --no-audit' }
        ];

        for (const tc of testCases) {
            (unifiedGenerate as any).mockResolvedValue({
                text: JSON.stringify({
                    code: tc.bad,
                    description: 'fix',
                    confidence: 0.9,
                    reasoning: 'r'
                })
            });

            const result = await generatePatchCandidates(
                mockConfig as any,
                mockFaultLocation,
                'input',
                'Error'
            );

            expect(result.primaryCandidate.code).toBe(tc.good);
        }
    });

    it('should identify spelling errors and apply confidence penalty', async () => {
        const typoCode = 'const myVar = "This contains a msispelled word";';
        
        (unifiedGenerate as any).mockResolvedValue({
            text: JSON.stringify({
                code: typoCode,
                description: 'fix with typo',
                confidence: 0.9,
                reasoning: 'r'
            })
        });

        const result = await generatePatchCandidates(
            mockConfig as any,
            { file: 'test.ts', line: 1, confidence: 1.0, reasoning: 'r' },
            'input',
            'Error'
        );

        const primary = result.primaryCandidate;
        if (!primary.spellingErrors) {
            console.log('DEBUG: No spelling errors found. Confidence was:', primary.confidence);
        }

        expect(primary.spellingErrors, 'Should have identified msispelled').toBeDefined();
        expect(primary.spellingErrors).toContain('msispelled');
        expect(primary.confidence, 'Confidence should be penalized').toBeLessThan(0.9);
    });

    it('should apply flag fixes to non-Dockerfile files (generic post-processing)', async () => {
        const bashLocation = { file: 'script.sh', line: 1, confidence: 1.0, reasoning: 'r' };

        (unifiedGenerate as any).mockResolvedValue({
            text: JSON.stringify({
                code: `#!/bin/bash\napt-get install -y --no-installfrrecommends git`,
                description: 'fix',
                confidence: 0.9,
                reasoning: 'r'
            })
        });

        const result = await generatePatchCandidates(
            mockConfig as any,
            bashLocation,
            '#!/bin/bash',
            'Error'
        );

        expect(result.primaryCandidate.code).toContain('--no-install-recommends');
    });
});