
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

                const badCode = 'RUN apt-get update && \\\\\n    apt-get install -y \\\\\n    # This is a bad comment \\\\\n    curl \\\\\n    vim';

                

                const expectedCode = 'RUN apt-get update && \\\\\n    apt-get install -y \\\\\n    curl \\\\\n    vim';

        

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

        

            it('should fix various apt-get flag typos using robust regex', async () => {

                const testCases = [

                    { bad: '--no-installfrrecommends', good: '--no-install-recommends' },

                    { bad: '--no-install-recommend', good: '--no-install-recommends' },

                    { bad: '--no-installrecommends', good: '--no-install-recommends' },

                    { bad: '--no-install-recomends', good: '--no-install-recommends' }

                ];

        

                for (const tc of testCases) {

                    (unifiedGenerate as any).mockResolvedValue({ 

                        text: JSON.stringify({ 

                            code: `RUN apt-get install -y ${tc.bad} curl`, 

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

        

                                expect(result.primaryCandidate.code).toBe(`RUN apt-get install -y ${tc.good} curl`);

        

                                if (tc.bad !== tc.good) {

        

                                    expect(result.primaryCandidate.code).not.toBe(`RUN apt-get install -y ${tc.bad} curl`);

        

                                }

        

                    

                }

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

    
