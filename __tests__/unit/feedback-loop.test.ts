
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    refinePatchWithFeedback,
    iterativeRefinement,
    FeedbackEntry,
    RefinementResult
} from '../../services/repair-agent/feedback-loop';
import { AppConfig } from '../../types';
import { PatchCandidate } from '../../services/repair-agent/patch-generation';
import { ValidationResult } from '../../services/repair-agent/patch-validation';

// Mock LLMService
const mocks = vi.hoisted(() => ({
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn()
}));

vi.mock('../../services/llm/LLMService.js', () => ({
    unifiedGenerate: mocks.unifiedGenerate,
    safeJsonParse: mocks.safeJsonParse
}));

describe('Feedback Loop', () => {
    const mockConfig = {} as AppConfig;
    const mockPatch: PatchCandidate = {
        id: 'patch-1',
        code: 'original code',
        confidence: 0.8,
        strategy: 'single'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('refinePatchWithFeedback', () => {
        it('should generate refined patch based on feedback', async () => {
            const validationResult: ValidationResult = {
                patchId: 'patch-1',
                passed: false,
                testsPassed: false,
                syntaxValid: true,
                staticAnalysisPassed: true,
                executionTime: 100,
                details: { testsRun: 5, testsFailed: 1, lintErrors: 0, typeErrors: 0 },
                errorMessage: 'Test failed'
            };

            const refinedCode = 'refined code';
            mocks.unifiedGenerate.mockResolvedValue({ text: 'json response' });
            mocks.safeJsonParse.mockReturnValue({
                code: refinedCode,
                description: 'fixed test',
                confidence: 0.9,
                reasoning: 'fixed logic'
            });

            const result = await refinePatchWithFeedback(mockConfig, mockPatch, validationResult);

            expect(mocks.unifiedGenerate).toHaveBeenCalled();
            expect(result.refinedPatch.code).toBe(refinedCode);
            expect(result.feedbackApplied).toContain('1 tests failed - fix must pass all tests');
            expect(result.feedbackApplied).toContain('Error: Test failed');
            expect(result.iterationCount).toBe(1);
        });

        it('should include previous feedback in context', async () => {
            const validationResult: ValidationResult = {
                patchId: 'patch-1',
                passed: false,
                testsPassed: true,
                syntaxValid: false,
                staticAnalysisPassed: true,
                executionTime: 100,
                details: { testsRun: 0, testsFailed: 0, lintErrors: 0, typeErrors: 0 }
            };

            const previousFeedback: FeedbackEntry[] = [{
                patchId: 'patch-0',
                validationResult: { ...validationResult, passed: false },
                timestamp: 123,
                learnings: ['Previous error']
            }];

            mocks.unifiedGenerate.mockResolvedValue({ text: '{}' });
            mocks.safeJsonParse.mockReturnValue({ code: 'code', confidence: 0.9 });

            await refinePatchWithFeedback(mockConfig, mockPatch, validationResult, previousFeedback);

            const promptCall = mocks.unifiedGenerate.mock.calls[0][1].contents;
            expect(promptCall).toContain('## Previous Attempts and Learnings');
            expect(promptCall).toContain('Previous error');
        });
    });

    describe('iterativeRefinement', () => {
        it('should return immediately if initial patch passes', async () => {
            const validateFn = vi.fn().mockResolvedValue({ passed: true });

            const result = await iterativeRefinement(mockConfig, mockPatch, validateFn);

            expect(result.finalPatch).toBe(mockPatch);
            expect(result.iterations).toBe(1);
            expect(mocks.unifiedGenerate).not.toHaveBeenCalled();
        });

        it('should refine patch until it passes', async () => {
            const failedResult = { passed: false, details: {} } as ValidationResult;
            const passedResult = { passed: true, details: {} } as ValidationResult;

            const validateFn = vi.fn()
                .mockResolvedValueOnce(failedResult) // Initial fails
                .mockResolvedValueOnce(passedResult); // Refined passes

            mocks.unifiedGenerate.mockResolvedValue({ text: '{}' });
            mocks.safeJsonParse.mockReturnValue({
                code: 'refined code',
                confidence: 0.9
            });

            const result = await iterativeRefinement(mockConfig, mockPatch, validateFn, 3);

            expect(validateFn).toHaveBeenCalledTimes(2);
            expect(result.iterations).toBe(2);
            expect(result.finalPatch.code).toBe('refined code');
        });

        it('should stop after max iterations', async () => {
            const failedResult = { passed: false, details: {} } as ValidationResult;
            const validateFn = vi.fn().mockResolvedValue(failedResult);

            mocks.unifiedGenerate.mockResolvedValue({ text: '{}' });
            mocks.safeJsonParse.mockReturnValue({ code: 'refined', confidence: 0.9 });

            const result = await iterativeRefinement(mockConfig, mockPatch, validateFn, 2);

            expect(validateFn).toHaveBeenCalledTimes(2);
            expect(result.iterations).toBe(2);
            expect(result.validationResult.passed).toBe(false);
        });
    });
});
