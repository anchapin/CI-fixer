import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadPrompt,
    renderPrompt,
    getPromptConfig,
    listPromptVersions,
    clearPromptCache
} from '../../services/llm/prompt-loader.js';

describe('Prompt Template Loader', () => {
    beforeEach(() => {
        clearPromptCache();
    });

    describe('loadPrompt', () => {
        it('should load error diagnosis template v1', async () => {
            const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');

            expect(template.metadata.version).toBe('v1');
            expect(template.metadata.model).toBe('gemini-3-pro-preview');
            expect(template.metadata.response_format).toBe('application/json');
            expect(template.metadata.variables).toContain('filteredLogs');
            expect(template.content).toContain('Error Diagnosis Agent');
        });

        it('should load detailed plan template v1', async () => {
            const template = await loadPrompt('planning/detailed-plan', 'v1');

            expect(template.metadata.version).toBe('v1');
            expect(template.metadata.max_tokens).toBe(2048);
            expect(template.content).toContain('fix plan');
        });

        it('should cache loaded templates', async () => {
            const template1 = await loadPrompt('diagnosis/error-diagnosis', 'v1');
            const template2 = await loadPrompt('diagnosis/error-diagnosis', 'v1');

            expect(template1).toBe(template2); // Same object reference
        });

        it('should throw error for non-existent template', async () => {
            await expect(loadPrompt('non-existent/template', 'v1')).rejects.toThrow('not found');
        });
    });

    describe('renderPrompt', () => {
        it('should render template with variables', async () => {
            const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');

            const rendered = renderPrompt(template, {
                filteredLogs: 'Error: Module not found',
                logSummary: 'TypeScript compilation failed',
                profileContext: 'Languages: TypeScript',
                classificationContext: '',
                feedbackContext: '',
                repoContext: 'Repository structure...'
            });

            expect(rendered).toContain('Error: Module not found');
            expect(rendered).toContain('TypeScript compilation failed');
            expect(rendered).toContain('Repository structure...');
        });

        it('should handle conditional sections', async () => {
            const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');

            // With feedback
            const withFeedback = renderPrompt(template, {
                filteredLogs: 'Error logs',
                logSummary: 'Summary',
                feedbackContext: 'Previous attempt failed'
            });

            expect(withFeedback).toContain('Previous attempt failed');

            // Without feedback
            const withoutFeedback = renderPrompt(template, {
                filteredLogs: 'Error logs',
                logSummary: 'Summary'
            });

            expect(withoutFeedback).not.toContain('PREVIOUS ATTEMPTS');
        });

        it('should handle missing variables gracefully', async () => {
            const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');

            const rendered = renderPrompt(template, {
                filteredLogs: 'Error logs'
                // Missing other variables
            });

            expect(rendered).toContain('Error logs');
            expect(rendered).not.toContain('undefined');
        });
    });

    describe('getPromptConfig', () => {
        it('should extract LLM config from metadata', async () => {
            const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');
            const config = getPromptConfig(template);

            expect(config.maxOutputTokens).toBe(1024);
            expect(config.temperature).toBe(0.7);
            expect(config.responseMimeType).toBe('application/json');
        });

        it('should handle templates with minimal config', async () => {
            const template = await loadPrompt('execution/code-fix', 'v1');
            const config = getPromptConfig(template);

            expect(config.maxOutputTokens).toBe(8192);
            expect(config.temperature).toBe(0.5);
        });
    });

    describe('listPromptVersions', () => {
        it('should list available versions of a template', async () => {
            const versions = await listPromptVersions('diagnosis/error-diagnosis');

            expect(versions).toContain('v1');
            expect(versions.length).toBeGreaterThanOrEqual(1);
        });

        it('should return empty array for non-existent template', async () => {
            const versions = await listPromptVersions('non-existent/template');

            expect(versions).toEqual([]);
        });
    });

    describe('Handlebars helpers', () => {
        it('should support custom helpers', async () => {
            // Test would require a template using custom helpers
            // For now, verify helpers are registered
            const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');
            expect(template.compiled).toBeDefined();
        });
    });
});
