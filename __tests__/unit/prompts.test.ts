import { describe, it, expect } from 'vitest';
import { generateFixPrompt, generateDiagnosisPrompt, generateChainOfThoughtPrompt } from '../../services/llm/prompts.js';
import { getErrorTemplate, getErrorCategories } from '../../services/llm/error-templates.js';

describe('Prompt Optimization', () => {
    describe('generateFixPrompt', () => {
        it('should generate structured fix prompt with all required sections', () => {
            const prompt = generateFixPrompt({
                filePath: 'test.ts',
                errorMessage: 'SyntaxError: Unexpected token',
                errorCategory: 'syntax',
                errorLine: 10,
                rootCause: 'Missing semicolon',
                fileContent: 'const x = 1',
                language: 'typescript',
                examplePattern: 'Add semicolon at end of statement'
            });

            expect(prompt).toContain('COMPLETE code');
            expect(prompt).toContain('Requirements');
            expect(prompt).toContain('Example Fix Pattern');
            expect(prompt).toContain('syntax');
            expect(prompt).toContain('test.ts');
            expect(prompt).toContain('Line 10');
        });

        it('should handle missing error line gracefully', () => {
            const prompt = generateFixPrompt({
                filePath: 'test.ts',
                errorMessage: 'Error',
                errorCategory: 'runtime',
                rootCause: 'Null reference',
                fileContent: 'code',
                language: 'typescript',
                examplePattern: 'Add null check'
            });

            expect(prompt).not.toContain('Location:');
            expect(prompt).toContain('runtime');
        });
    });

    describe('generateDiagnosisPrompt', () => {
        it('should include few-shot examples', () => {
            const prompt = generateDiagnosisPrompt({
                errorLog: 'Error: Cannot find module "express"'
            });

            expect(prompt).toContain('Example 1');
            expect(prompt).toContain('Example 2');
            expect(prompt).toContain('Example 3');
            expect(prompt).toContain('Dependency Error');
            expect(prompt).toContain('Syntax Error');
            expect(prompt).toContain('Type Error');
        });

        it('should include repo context when provided', () => {
            const prompt = generateDiagnosisPrompt({
                errorLog: 'Test error',
                repoContext: 'TypeScript project with Jest'
            });

            expect(prompt).toContain('Repository Context');
            expect(prompt).toContain('TypeScript project with Jest');
        });

        it('should include feedback history when provided', () => {
            const prompt = generateDiagnosisPrompt({
                errorLog: 'Test error',
                feedbackHistory: ['First attempt failed', 'Second attempt failed']
            });

            expect(prompt).toContain('Previous Attempts');
            expect(prompt).toContain('First attempt failed');
            expect(prompt).toContain('Second attempt failed');
        });
    });

    describe('generateChainOfThoughtPrompt', () => {
        it('should include step-by-step reasoning structure', () => {
            const prompt = generateChainOfThoughtPrompt({
                filePath: 'complex.ts',
                errorMessage: 'Complex error',
                errorCategory: 'runtime',
                rootCause: 'Multiple issues',
                fileContent: 'complex code',
                language: 'typescript',
                examplePattern: 'Multiple fixes needed'
            });

            expect(prompt).toContain('step-by-step');
            expect(prompt).toContain('Understand the Error');
            expect(prompt).toContain('Identify Dependencies');
            expect(prompt).toContain('Plan the Fix');
            expect(prompt).toContain('Implement');
            expect(prompt).toContain('Verify');
            expect(prompt).toContain('reasoning');
            expect(prompt).toContain('root_cause');
            expect(prompt).toContain('dependencies');
            expect(prompt).toContain('plan');
            expect(prompt).toContain('edge_cases');
            expect(prompt).toContain('fixed_code');
        });
    });

    describe('Error Templates', () => {
        it('should return template for known error category', () => {
            const template = getErrorTemplate('dependency');
            expect(template.pattern).toContain('package.json');
            expect(template.example).toContain('npm install');
        });

        it('should return template for syntax errors', () => {
            const template = getErrorTemplate('syntax');
            expect(template.pattern).toContain('brackets');
            expect(template.pattern.toLowerCase()).toContain('semicolons');
        });

        it('should return template for type errors', () => {
            const template = getErrorTemplate('type');
            expect(template.pattern).toContain('null');
            expect(template.pattern).toContain('undefined');
            expect(template.example).toContain('?.');
        });

        it('should return default template for unknown category', () => {
            const template = getErrorTemplate('unknown_category');
            expect(template.pattern).toContain('Analyze the error');
            expect(template.example).toBeTruthy();
        });

        it('should handle category name variations', () => {
            const template1 = getErrorTemplate('test_failure');
            const template2 = getErrorTemplate('test-failure');
            const template3 = getErrorTemplate('TEST_FAILURE');

            expect(template1.pattern).toContain('test');
            expect(template2.pattern).toContain('test');
            expect(template3.pattern).toContain('test');
        });

        it('should list all available error categories', () => {
            const categories = getErrorCategories();
            expect(categories).toContain('dependency');
            expect(categories).toContain('syntax');
            expect(categories).toContain('type');
            expect(categories).toContain('runtime');
            expect(categories).toContain('build');
            expect(categories).toContain('test_failure');
            expect(categories).toContain('timeout');
            expect(categories).toContain('configuration');
        });
    });

    describe('Prompt Quality Checks', () => {
        it('should not contain truncation indicators in fix prompt', () => {
            const prompt = generateFixPrompt({
                filePath: 'test.ts',
                errorMessage: 'Error',
                errorCategory: 'syntax',
                rootCause: 'Issue',
                fileContent: 'code',
                language: 'typescript',
                examplePattern: 'Fix'
            });

            // Check that requirements explicitly emphasize completeness
            expect(prompt).toContain('COMPLETE');
            expect(prompt).toContain('no truncation');
            expect(prompt).toContain('no placeholders');
        });

        it('should enforce JSON output in diagnosis prompt', () => {
            const prompt = generateDiagnosisPrompt({
                errorLog: 'Test error'
            });

            expect(prompt).toContain('JSON');
            expect(prompt).toContain('ONLY the JSON object');
            expect(prompt).toContain('no additional text');
        });
    });
});
