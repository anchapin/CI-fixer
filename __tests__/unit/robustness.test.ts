
import { describe, it, expect } from 'vitest';
import { toolLintCheck } from '../../services';
import { AppConfig } from '../../types';

describe('Robustness Improvements', () => {
    const mockConfig: AppConfig = {
        repoUrl: 'mock/repo',
        githubToken: 'mock_token',
        llmProvider: 'google',
        // @ts-ignore
        devEnv: 'simulation'
    };

    describe('toolLintCheck', () => {
        it('should return specific error message for invalid YAML', async () => {
            const invalidYaml = `
name: Invalid Workflow
on: [push
steps:
  - run: echo "Missing closing bracket"
`;
            const result = await toolLintCheck(mockConfig, invalidYaml, 'yaml');

            expect(result.valid).toBe(false);
            expect(result.error).toContain('[YAML Syntax Error]');
            // js-yaml error messages usually contain "end of the stream or a document separator is expected" for this kind of error
            // or specific parsing errors. We just want to ensure it's not generic.
            expect(result.error?.length).toBeGreaterThan(20);
        });

        it('should validate correct YAML', async () => {
            const validYaml = `
name: Valid Workflow
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Hello"
`;
            const result = await toolLintCheck(mockConfig, validYaml, 'yaml');
            expect(result.valid).toBe(true);
        });
    });
});
