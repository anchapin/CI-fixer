import { describe, it, expect } from 'vitest';
import { AdaptiveModelSelector } from '../../services/llm/model-selector.js';

describe('AdaptiveModelSelector', () => {
    const selector = new AdaptiveModelSelector();

    describe('selectModel', () => {
        it('should use fast model for simple errors', () => {
            const model = selector.selectModel({
                complexity: 3,
                category: 'SYNTAX_ERROR',
                attemptNumber: 1,
                remainingBudget: 1.0
            });

            expect(model).toBe('gemini-2.5-flash');
        });

        it('should use smart model for complex errors on first attempt', () => {
            const model = selector.selectModel({
                complexity: 9,
                category: 'UNKNOWN',
                attemptNumber: 1,
                remainingBudget: 1.0
            });

            expect(model).toBe('gemini-3-pro-preview');
        });

        it('should downgrade to fast model when budget is low', () => {
            const model = selector.selectModel({
                complexity: 8,
                category: 'UNKNOWN',
                attemptNumber: 2,
                remainingBudget: 0.005 // Very low budget
            });

            expect(model).toBe('gemini-2.5-flash');
        });

        it('should use fast model when historical success rate is high', () => {
            const model = selector.selectModel({
                complexity: 6,
                category: 'IMPORT_ERROR',
                attemptNumber: 1,
                remainingBudget: 1.0,
                historicalSuccessRate: 0.85 // High success rate
            });

            expect(model).toBe('gemini-2.5-flash');
        });

        it('should alternate models on retries', () => {
            const model1 = selector.selectModel({
                complexity: 6,
                category: 'UNKNOWN',
                attemptNumber: 2,
                remainingBudget: 1.0
            });

            const model2 = selector.selectModel({
                complexity: 6,
                category: 'UNKNOWN',
                attemptNumber: 3,
                remainingBudget: 1.0
            });

            expect(model1).not.toBe(model2); // Should alternate
        });
    });

    describe('estimateCost', () => {
        it('should estimate cost for smart model', () => {
            const cost = selector.estimateCost('gemini-3-pro-preview', 2000);
            expect(cost).toBeGreaterThan(0);
            expect(cost).toBeCloseTo(0.02, 2); // 2K tokens * $0.01/1K
        });

        it('should estimate cost for fast model', () => {
            const cost = selector.estimateCost('gemini-2.5-flash', 2000);
            expect(cost).toBeGreaterThan(0);
            expect(cost).toBeLessThan(0.01); // Should be cheaper than smart model
        });
    });
});
