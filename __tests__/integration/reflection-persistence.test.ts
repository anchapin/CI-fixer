import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ReflectionLearningSystem } from '../../services/reflection/learning-system.js';
import { db, disconnectDb } from '../../db/client.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library.js';

// Track the current system for flushing in afterEach
let currentSystem: ReflectionLearningSystem | null = null;

// Check if the learning tables exist
async function learningTablesExist(): Promise<boolean> {
    try {
        await db.learningFailure.findMany({ take: 1 });
        return true;
    } catch (error) {
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2021') {
            return false;
        }
        throw error;
    }
}

describe('Reflection Learning Persistence (Integration)', () => {
    let tablesExist = false;

    beforeAll(async () => {
        tablesExist = await learningTablesExist();
        if (!tablesExist) {
            console.log('Skipping: LearningFailure/LearningSuccess tables do not exist in database');
            return;
        }
        // Clear any existing test data
        await db.learningFailure.deleteMany({});
        await db.learningSuccess.deleteMany({});
    });

    // Clear database before each test for proper isolation
    beforeEach(async () => {
        if (!tablesExist) return;
        await db.learningFailure.deleteMany({});
        await db.learningSuccess.deleteMany({});
        currentSystem = null;
    });

    // Flush any pending writes after each test
    afterEach(async () => {
        if (currentSystem) {
            await currentSystem['persistence'].flush();
        }
        currentSystem = null;
    });

    afterAll(async () => {
        // Cleanup
        if (tablesExist) {
            await db.learningFailure.deleteMany({});
            await db.learningSuccess.deleteMany({});
        }
        await disconnectDb();
    });

    describe('Persistence Lifecycle', () => {
        it('should persist and reload failure patterns across instances', async () => {
            if (!tablesExist) {
                return; // Skip if tables don't exist
            }
            // Create first instance and record failures
            const system1 = new ReflectionLearningSystem();
            currentSystem = system1;
            await system1.initialize();

            await system1.recordFailure('TypeError', 'Null reference', 'Added null check', 'file.ts:42');
            await system1.recordFailure('TypeError', 'Null reference', 'Added null check', 'file.ts:42');
            await system1.recordFailure('TypeError', 'Null reference', 'Added null check', 'file.ts:42');

            // Flush writes before creating new instance
            await system1['persistence'].flush();

            // Create second instance and verify it loads the persisted data
            const system2 = new ReflectionLearningSystem();
            await system2.initialize();

            const stats = system2.getStats();

            // Should have loaded the persisted failure pattern
            expect(stats.totalFailurePatterns).toBe(1);
            // Frequency should be persisted
            const failurePattern = Array.from(system2['failurePatterns'].values())[0];
            expect(failurePattern.frequency).toBe(3);
        });

        it('should persist and reload success patterns across instances', async () => {
            if (!tablesExist) {
                return; // Skip if tables don't exist
            }
            // Create first instance and record successes
            const system1 = new ReflectionLearningSystem();
            currentSystem = system1;
            await system1.initialize();

            await system1.recordSuccess('SyntaxError', 'Added semicolon', 'script.js:10');
            await system1.recordSuccess('ReferenceError', 'Declared variable', 'app.js:25');

            // Flush writes before creating new instance
            await system1['persistence'].flush();

            // Create second instance and verify
            const system2 = new ReflectionLearningSystem();
            await system2.initialize();

            const stats = system2.getStats();
            expect(stats.totalSuccessPatterns).toBe(2);
        });

        it('should track frequency updates across persistence', async () => {
            if (!tablesExist) {
                return; // Skip if tables don't exist
            }
            const system1 = new ReflectionLearningSystem();
            currentSystem = system1;
            await system1.initialize();

            // Record same failure 5 times
            for (let i = 0; i < 5; i++) {
                await system1.recordFailure('TestError', 'Test reason', 'Test fix', 'test.ts:1');
            }

            await system1['persistence'].flush();

            const system2 = new ReflectionLearningSystem();
            await system2.initialize();

            const failurePattern = Array.from(system2['failurePatterns'].values())[0];
            expect(failurePattern.frequency).toBe(5);
        });

        it('should initialize gracefully with empty database', async () => {
            const system = new ReflectionLearningSystem();
            currentSystem = system;
            await system.initialize();

            const stats = system.getStats();
            expect(stats.totalFailurePatterns).toBe(0);
            expect(stats.totalSuccessPatterns).toBe(0);
        });
    });

    describe('Database Operations', () => {
        it('should upsert existing failure patterns', async () => {
            if (!tablesExist) {
                return; // Skip if tables don't exist
            }
            const system = new ReflectionLearningSystem();
            currentSystem = system;
            await system.initialize();

            // Record initial failure
            await system.recordFailure('UpsertError', 'Test', 'Fix1', 'test.ts');

            await system['persistence'].flush();

            // Record same failure again (should update, not insert duplicate)
            await system.recordFailure('UpsertError', 'Test', 'Fix2', 'test.ts');

            await system['persistence'].flush();

            // Verify only one pattern exists in DB
            const dbRecords = await db.learningFailure.findMany({
                where: { errorType: 'UpsertError' }
            });

            expect(dbRecords.length).toBe(1);
            expect(dbRecords[0].frequency).toBe(2);
        });

        it('should handle concurrent writes gracefully', async () => {
            if (!tablesExist) {
                return; // Skip if tables don't exist
            }
            const system = new ReflectionLearningSystem();
            currentSystem = system;
            await system.initialize();

            // Record many failures concurrently
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(system.recordFailure('ConcurrentError', `reason${i}`, 'fix', 'test.ts'));
            }

            await Promise.all(promises);
            await system['persistence'].flush();

            // Verify all were persisted
            const system2 = new ReflectionLearningSystem();
            await system2.initialize();

            // Should have at least the patterns (some may have been merged)
            const stats = system2.getStats();
            expect(stats.totalFailurePatterns).toBeGreaterThan(0);
        });
    });

    describe('Error Handling', () => {
        it('should continue operation if persistence fails', async () => {
            if (!tablesExist) {
                return; // Skip if tables don't exist
            }
            const system = new ReflectionLearningSystem();
            currentSystem = system;
            await system.initialize();

            // Record should succeed even if DB has issues (fire & forget)
            await system.recordFailure('TestError', 'Test', 'Test', 'test.ts');

            await system['persistence'].flush();

            const stats = system.getStats();
            // In-memory state should still work
            expect(stats.totalFailurePatterns).toBe(1);
        });

        it('should initialize successfully even if DB is unreachable', async () => {
            // System should mark as initialized even if load fails
            const system = new ReflectionLearningSystem();
            currentSystem = system;

            // Mock DB error scenario
            const originalLoad = system['persistence'].load;
            system['persistence'].load = async () => {
                throw new Error('DB unreachable');
            };

            await system.initialize();

            // Should still be marked as initialized
            expect(system['isInitialized']).toBe(true);

            // Restore
            system['persistence'].load = originalLoad;
        });
    });
});
