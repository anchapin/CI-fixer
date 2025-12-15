import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTestDatabase } from '../helpers/test-database.js';
import { TrajectoryAnalyzer } from '../../services/analytics/trajectory-analyzer.js';

describe('TrajectoryAnalyzer Integration', () => {
    let testDb: InMemoryTestDatabase;
    let db: any;
    let analyzer: TrajectoryAnalyzer;

    beforeEach(async () => {
        testDb = new InMemoryTestDatabase();
        db = await testDb.setup();
        analyzer = new TrajectoryAnalyzer(db);
    });

    afterEach(async () => {
        await testDb.teardown();
    });

    describe('recordTrajectory', () => {
        it('should record a new trajectory', async () => {
            await analyzer.recordTrajectory(
                'SYNTAX_ERROR',
                3,
                ['syntax_validator', 'linter'],
                true,
                0.005,
                500,
                95.5
            );

            const trajectories = await db.fixTrajectory.findMany({
                where: { errorCategory: 'SYNTAX_ERROR' }
            });

            expect(trajectories).toHaveLength(1);
            expect(trajectories[0].complexity).toBe(3);
            expect(trajectories[0].success).toBe(true);
            expect(trajectories[0].totalCost).toBe(0.005);
            expect(trajectories[0].reward).toBe(95.5);
        });

        it('should update existing trajectory with running average', async () => {
            // First record
            await analyzer.recordTrajectory(
                'TEST_FAILURE',
                5,
                ['test_runner', 'git_blame_analyzer'],
                true,
                0.02,
                5000,
                85.0
            );

            // Second record with same trajectory
            await analyzer.recordTrajectory(
                'TEST_FAILURE',
                5,
                ['test_runner', 'git_blame_analyzer'],
                true,
                0.03,
                6000,
                90.0
            );

            const trajectories = await db.fixTrajectory.findMany({
                where: { errorCategory: 'TEST_FAILURE' }
            });

            expect(trajectories).toHaveLength(1);
            expect(trajectories[0].occurrenceCount).toBe(2);
            // Average cost: (0.02 + 0.03) / 2 = 0.025
            expect(trajectories[0].totalCost).toBeCloseTo(0.025, 3);
            // Average reward: (85 + 90) / 2 = 87.5
            expect(trajectories[0].reward).toBeCloseTo(87.5, 1);
        });
    });

    describe('findOptimalPath', () => {
        it('should return null when no trajectories exist', async () => {
            const path = await analyzer.findOptimalPath('UNKNOWN_ERROR', 5);
            expect(path).toBeNull();
        });

        it('should return the best trajectory for an error category', async () => {
            // Record multiple trajectories
            await analyzer.recordTrajectory(
                'IMPORT_ERROR',
                4,
                ['dependency_resolver'],
                true,
                0.01,
                500,
                92.0
            );

            await analyzer.recordTrajectory(
                'IMPORT_ERROR',
                4,
                ['dependency_resolver', 'linter'],
                true,
                0.012,
                600,
                95.0 // Higher reward
            );

            const path = await analyzer.findOptimalPath('IMPORT_ERROR', 4);

            expect(path).toEqual(['dependency_resolver', 'linter']);
        });

        it('should find trajectories within complexity range', async () => {
            await analyzer.recordTrajectory(
                'SYNTAX_ERROR',
                5,
                ['syntax_validator', 'static_analyzer'],
                true,
                0.003,
                250,
                94.0
            );

            // Should find trajectory even with slightly different complexity
            const path = await analyzer.findOptimalPath('SYNTAX_ERROR', 6);
            expect(path).toEqual(['syntax_validator', 'static_analyzer']);
        });

        it('should only return successful trajectories', async () => {
            // Record failed trajectory
            await analyzer.recordTrajectory(
                'COMPLEX_ERROR',
                8,
                ['semantic_code_search', 'llm_code_generator'],
                false, // Failed
                0.15,
                11000,
                -20.0
            );

            // Record successful trajectory
            await analyzer.recordTrajectory(
                'COMPLEX_ERROR',
                8,
                ['syntax_validator', 'llm_code_generator'],
                true,
                0.10,
                8000,
                80.0
            );

            const path = await analyzer.findOptimalPath('COMPLEX_ERROR', 8);
            expect(path).toEqual(['syntax_validator', 'llm_code_generator']);
        });
    });

    describe('getStats', () => {
        it('should return null when no data exists', async () => {
            const stats = await analyzer.getStats('NONEXISTENT');
            expect(stats).toBeNull();
        });

        it('should calculate statistics correctly', async () => {
            // Record 3 successful attempts
            await analyzer.recordTrajectory('TYPE_ERROR', 4, ['static_analyzer'], true, 0.002, 150, 95.0);
            await analyzer.recordTrajectory('TYPE_ERROR', 4, ['static_analyzer'], true, 0.002, 150, 95.0);
            await analyzer.recordTrajectory('TYPE_ERROR', 4, ['static_analyzer'], true, 0.002, 150, 95.0);

            // Record 1 failed attempt
            await analyzer.recordTrajectory('TYPE_ERROR', 4, ['llm_code_generator'], false, 0.10, 8000, -30.0);

            const stats = await analyzer.getStats('TYPE_ERROR');

            expect(stats).not.toBeNull();
            expect(stats!.totalAttempts).toBe(4);
            expect(stats!.successRate).toBe(0.75); // 3/4
            expect(stats!.avgCost).toBeCloseTo(0.0265, 3); // (0.002*3 + 0.10*1) / 4
        });
    });
});
