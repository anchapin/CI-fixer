import { describe, it, expect, vi, beforeEach } from 'vitest';
import { postProcessPatch, checkSpelling, calculateSpellingPenalty } from '../../../../services/repair-agent/post-processor';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

vi.mock('node:fs');
vi.mock('node:child_process');

describe('PostProcessor Enhanced', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default fs.existsSync to true for localCspell check in some tests
        vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    describe('postProcessPatch', () => {
        it('should skip dockerfile cleaning for non-dockerfiles', () => {
            const code = 'const x = 1; # not an inline comment';
            const result = postProcessPatch('test.ts', code);
            expect(result).toBe(code);
        });

                it('should identify different dockerfile patterns', () => {
                    const code = `RUN command \\ \n # comment\n next`;
                    // .dockerfile extension
                    expect(postProcessPatch('service.dockerfile', code)).not.toContain('# comment');
                    // dockerfile.something
                    expect(postProcessPatch('dockerfile.prod', code)).not.toContain('# comment');
                });    });

    describe('stripDockerfileInlineComments', () => {
        it('should keep normal comments in Dockerfile', () => {
            const code = '# This is a normal comment\nFROM node:20';
            const result = postProcessPatch('Dockerfile', code);
            expect(result).toBe(code);
        });
    });

    describe('checkSpelling', () => {
        const mockCode = 'some code';
        const mockFilename = 'test.ts';

        it('should use local cspell if it exists', () => {
            vi.mocked(fs.existsSync).mockImplementation((p: any) => p.toString().includes('node_modules'));
            checkSpelling(mockFilename, mockCode);
            expect(execSync).toHaveBeenCalledWith(expect.stringContaining('node_modules'), expect.anything());
        });

        it('should return empty array if cspell succeeds', () => {
            vi.mocked(execSync).mockReturnValue('' as any);
            const result = checkSpelling(mockFilename, mockCode);
            expect(result).toEqual([]);
        });

        it('should parse unknown words from cspell output', () => {
            const error: any = new Error('Command failed');
            error.stdout = 'test.ts:1:1 - Unknown word (msispelled)\ntest.ts:2:1 - Unknown word (anothererr)\ntest.ts:3:1 - Unknown word (msispelled)';
            vi.mocked(execSync).mockImplementation(() => { throw error; });

            const result = checkSpelling(mockFilename, mockCode);
            expect(result).toEqual(['msispelled', 'anothererr']); // Deduplicated
        });

        it('should handle generic exceptions in checkSpelling', () => {
            vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error('write failed'); });
            const result = checkSpelling(mockFilename, mockCode);
            expect(result).toEqual([]);
        });

        it('should use .txt extension if filename has none', () => {
            checkSpelling('Makefile', mockCode);
            expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('.txt'), expect.anything());
        });
    });

    describe('calculateSpellingPenalty', () => {
        it('should return 0 for 0 errors', () => {
            expect(calculateSpellingPenalty(0)).toBe(0);
        });

        it('should return 0.05 for 1-3 errors', () => {
            expect(calculateSpellingPenalty(1)).toBe(0.05);
            expect(calculateSpellingPenalty(3)).toBe(0.05);
        });

        it('should return steeper penalty for >3 errors', () => {
            // 4 errors: 0.1 + (4-3)*0.02 = 0.12
            expect(calculateSpellingPenalty(4)).toBeCloseTo(0.12);
            // 10 errors: 0.1 + (10-3)*0.02 = 0.1 + 0.14 = 0.24
            expect(calculateSpellingPenalty(10)).toBeCloseTo(0.24);
        });
    });
});
