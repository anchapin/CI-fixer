import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolLintCheck, unifiedGenerate } from '../../services';
import { AppConfig } from '../../types';

// Mock Config
const mockConfig: AppConfig = {
    githubToken: 'test-token',
    repoUrl: 'owner/repo',
    prUrl: 'https://github.com/owner/repo/pull/1',
    selectedRuns: [],
    excludeWorkflowPatterns: [],
    llmProvider: 'zai',
    llmBaseUrl: 'https://api.test',
    llmModel: 'test-model',
    customApiKey: 'test-key',
    searchProvider: 'tavily',
    tavilyApiKey: 'test-tavily',
    devEnv: 'e2b',
    checkEnv: 'e2b',
    e2bApiKey: 'e2b_test'
};

describe('Reliability Improvements', () => {

    describe('YAML Validation (toolLintCheck)', () => {
        it('should pass valid YAML', async () => {
            const validYaml = `
name: Test Workflow
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
`;
            const result = await toolLintCheck(mockConfig, validYaml, 'yaml');
            expect(result.valid).toBe(true);
        });

        it('should fail invalid YAML (syntax error)', async () => {
            const invalidYaml = `
name: Test Workflow
on: [push]
jobs:
  - invalid sequence
  mapping: value
`; // Mixed block/flow or bad indentation that confuses generic parsers

            // Definitely invalid: Unclosed bracket
            const definitelyInvalid = `
jobs:
  build:
    steps: [
      - uses: actions/checkout
    # Missing closing bracket
`;
            const result = await toolLintCheck(mockConfig, definitelyInvalid, 'yaml');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('YAML Syntax Error');
        });
    });

    describe('Network Retries (unifiedGenerate)', () => {
        let fetchSpy: any;

        beforeEach(() => {
            fetchSpy = vi.spyOn(global, 'fetch');
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.restoreAllMocks();
            vi.useRealTimers();
        });

        it('should retry on network errors (fetch failed)', async () => {
            // Mock fetch to fail 2 times then succeed
            fetchSpy
                .mockRejectedValueOnce(new Error('fetch failed'))
                .mockRejectedValueOnce(new Error('fetch failed'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ choices: [{ message: { content: 'Success after retry' } }] })
                } as Response);

            // Trigger promise
            const promise = unifiedGenerate(mockConfig, { contents: 'test' });

            // Run timers to exhaust backoff delays
            await vi.runAllTimersAsync();

            const result = await promise;
            expect(result).toBeDefined();
            expect(result.text).toBe('Success after retry');
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });

        it('should throw after exhausting retries', async () => {
            fetchSpy.mockRejectedValue(new Error('Permanent Network Error'));

            const promise = unifiedGenerate(mockConfig, { contents: 'test' });

            // Capture the rejection promise BEFORE running timers to avoid "Unhandled Rejection"
            const rejectionExp = expect(promise).rejects.toThrow('LLM Generation Failed after retries');

            // Run all timers to ensure we exhaust retries
            await vi.runAllTimersAsync();

            await rejectionExp;

            expect(fetchSpy).toHaveBeenCalledTimes(5);
        });
    });
});
