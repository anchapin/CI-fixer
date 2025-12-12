import { beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TestDatabaseManager, InMemoryTestDatabase, testDataSeeds } from './test-database';

/**
 * Global test database instance
 * Can be accessed in any test that uses setupTestDatabase()
 */
let testDb: TestDatabaseManager | null = null;
let prismaClient: PrismaClient | null = null;

/**
 * Sets up test database for integration/unit tests
 * 
 * Usage in test file:
 * ```typescript
 * import { setupTestDatabase, getTestDb } from '../helpers/vitest-setup';
 * 
 * setupTestDatabase();
 * 
 * describe('My Test Suite', () => {
 *   it('should work with database', async () => {
 *     const db = getTestDb();
 *     await db.agentRun.create({ ... });
 *   });
 * });
 * ```
 * 
 * @param useInMemory - If true, uses in-memory SQLite (faster). Default: false
 * @param seedData - If true, seeds database with test data. Default: false
 */
export function setupTestDatabase(useInMemory = false, seedData = false) {
    beforeAll(async () => {
        testDb = useInMemory ? new InMemoryTestDatabase() : new TestDatabaseManager();
        prismaClient = await testDb.setup();

        if (seedData) {
            await testDataSeeds.createAgentRun(prismaClient, { id: 'default-run' });
            await testDataSeeds.createActionTemplates(prismaClient);
            await testDataSeeds.createFixPatterns(prismaClient);
            await testDataSeeds.createErrorSolutions(prismaClient);
        }
    });

    afterAll(async () => {
        if (testDb) {
            await testDb.teardown();
            testDb = null;
            prismaClient = null;
        }
    });

    beforeEach(async () => {
        // Clear data between tests for isolation (but keep schema)
        if (testDb && !seedData) {
            await testDb.clearAllData();
        }
    });
}

/**
 * Gets the current test database Prisma client
 * Must be called after setupTestDatabase()
 */
export function getTestDb(): PrismaClient {
    if (!prismaClient) {
        throw new Error('Test database not initialized. Call setupTestDatabase() in your test suite.');
    }
    return prismaClient;
}

/**
 * Gets the test database manager instance
 */
export function getTestDbManager(): TestDatabaseManager {
    if (!testDb) {
        throw new Error('Test database not initialized. Call setupTestDatabase() in your test suite.');
    }
    return testDb;
}

/**
 * Manually seeds test data (useful for specific test cases)
 */
export async function seedTestData() {
    const db = getTestDb();
    await testDataSeeds.createAgentRun(db);
    await testDataSeeds.createActionTemplates(db);
    await testDataSeeds.createFixPatterns(db);
    await testDataSeeds.createErrorSolutions(db);
}

/**
 * Clears all data from the test database
 */
export async function clearTestData() {
    const manager = getTestDbManager();
    await manager.clearAllData();
}

/**
 * Mock the db/client module to use test database
 * Call this in vi.mock() calls
 * 
 * Usage:
 * ```typescript
 * import { mockDbClient } from '../helpers/vitest-setup';
 * 
 * vi.mock('../../db/client', () => mockDbClient());
 * ```
 */
export function mockDbClient() {
    return {
        db: prismaClient || new PrismaClient()
    };
}

/**
 * Quick setup for tests that need real DB but no seed data
 */
export const setupTestDb = () => setupTestDatabase(false, false);

/**
 * Quick setup for tests that need real DB with seed data
 */
export const setupTestDbWithSeeds = () => setupTestDatabase(false, true);

/**
 * Quick setup for tests that need in-memory DB (fastest)
 */
export const setupInMemoryDb = () => setupTestDatabase(true, false);

/**
 * Quick setup for tests that need in-memory DB with seed data
 */
export const setupInMemoryDbWithSeeds = () => setupTestDatabase(true, true);
