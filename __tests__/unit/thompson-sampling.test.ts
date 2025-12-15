import { describe, it, expect, beforeEach } from 'vitest';
import { ThompsonSamplingRefiner, calculateAdaptiveLimit, IterationContext } from '../../services/iterative-refinement/thompson-sampling.js';

describe('Iterative Refinement', () => {
    let refiner: ThompsonSamplingRefiner;

    beforeEach(() => {
        refiner = new ThompsonSamplingRefiner();
    });

    describe('Thompson Sampling', () => {
        it('should initialize with prior', () => {
            const stats = refiner.getStats();

            expect(stats.continue).toBeDefined();
            expect(stats.terminate).toBeDefined();
            expect(stats.continue.alpha).toBe(1);
            expect(stats.continue.beta).toBe(1);
        });

        it('should make iteration decisions', () => {
            const context: IterationContext = {
                currentIteration: 2,
                maxIterations: 10,
                successHistory: [true, false],
                costSoFar: 500,
                maxCost: 2000
            };

            const decision = refiner.decideIteration(context);

            expect(decision.action).toMatch(/continue|terminate/);
            expect(decision.confidence).toBeGreaterThanOrEqual(0);
            expect(decision.confidence).toBeLessThanOrEqual(1);
            expect(decision.reasoning).toBeDefined();
        });

        it('should terminate at max iterations', () => {
            const context: IterationContext = {
                currentIteration: 10,
                maxIterations: 10,
                successHistory: [true],
                costSoFar: 500,
                maxCost: 2000
            };

            const decision = refiner.decideIteration(context);

            expect(decision.action).toBe('terminate');
            expect(decision.confidence).toBe(1.0);
        });

        it('should terminate at max cost', () => {
            const context: IterationContext = {
                currentIteration: 3,
                maxIterations: 10,
                successHistory: [true],
                costSoFar: 2000,
                maxCost: 2000
            };

            const decision = refiner.decideIteration(context);

            expect(decision.action).toBe('terminate');
            expect(decision.reasoning).toContain('cost');
        });

        it('should update arm statistics', () => {
            const initialStats = refiner.getStats();
            const initialAlpha = initialStats.continue.alpha;

            refiner.updateArm('continue', true);

            const updatedStats = refiner.getStats();
            expect(updatedStats.continue.alpha).toBe(initialAlpha + 1);
        });

        it('should calculate mean correctly', () => {
            refiner.updateArm('continue', true);
            refiner.updateArm('continue', true);
            refiner.updateArm('continue', false);

            const stats = refiner.getStats();
            // alpha = 3, beta = 2, mean = 3/5 = 0.6
            expect(stats.continue.mean).toBeCloseTo(0.6, 1);
        });
    });

    describe('Adaptive Limits', () => {
        it('should calculate adaptive limit based on complexity', () => {
            const limit1 = calculateAdaptiveLimit(5, 3, 0.8, 1000);
            const limit2 = calculateAdaptiveLimit(5, 9, 0.8, 1000);

            // Higher complexity should give higher limit
            expect(limit2).toBeGreaterThan(limit1);
        });

        it('should adjust for success rate', () => {
            const lowSuccess = calculateAdaptiveLimit(5, 5, 0.3, 1000);
            const highSuccess = calculateAdaptiveLimit(5, 5, 0.8, 1000);

            // Higher success rate should give higher limit
            expect(highSuccess).toBeGreaterThan(lowSuccess);
        });

        it('should respect min and max bounds', () => {
            const veryLow = calculateAdaptiveLimit(5, 1, 0.1, 100);
            const veryHigh = calculateAdaptiveLimit(5, 10, 1.0, 10000);

            expect(veryLow).toBeGreaterThanOrEqual(3);
            expect(veryHigh).toBeLessThanOrEqual(15);
        });
    });
});
