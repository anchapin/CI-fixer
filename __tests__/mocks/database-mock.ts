/**
 * Database Mock Utility
 *
 * Provides consistent mocking for the Prisma database client across all tests
 * This ensures all tests have the expected database properties available
 */

import { vi } from 'vitest';

export function createMockDb() {
    return {
        errorFact: {
            findFirst: vi.fn(() => Promise.resolve(null)),
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            update: vi.fn(() => Promise.resolve({})),
            delete: vi.fn(() => Promise.resolve({}))
        },
        fileModification: {
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            findFirst: vi.fn(() => Promise.resolve(null))
        },
        fixPattern: {
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            findFirst: vi.fn(() => Promise.resolve(null)),
            update: vi.fn(() => Promise.resolve({}))
        },
        errorSolution: {
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            findFirst: vi.fn(() => Promise.resolve(null))
        },
        actionTemplate: {
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            findFirst: vi.fn(() => Promise.resolve(null)),
            update: vi.fn(() => Promise.resolve({}))
        },
        errorDependency: {
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            delete: vi.fn(() => Promise.resolve({}))
        },
        errorCluster: {
            findMany: vi.fn(() => Promise.resolve([])),
            create: vi.fn(() => Promise.resolve({})),
            update: vi.fn(() => Promise.resolve({}))
        },
        agentRun: {
            create: vi.fn(() => Promise.resolve({})),
            findMany: vi.fn(() => Promise.resolve([])),
            findFirst: vi.fn(() => Promise.resolve(null)),
            update: vi.fn(() => Promise.resolve({}))
        },
        agentMetrics: {
            create: vi.fn(() => Promise.resolve({})),
            findMany: vi.fn(() => Promise.resolve([]))
        },
        fixAttempt: {
            create: vi.fn(() => Promise.resolve({})),
            findMany: vi.fn(() => Promise.resolve([]))
        },
        repositoryPreferences: {
            create: vi.fn(() => Promise.resolve({})),
            findMany: vi.fn(() => Promise.resolve([])),
            findFirst: vi.fn(() => Promise.resolve(null)),
            update: vi.fn(() => Promise.resolve({}))
        },
        fixTrajectory: {
            create: vi.fn(() => Promise.resolve({})),
            findMany: vi.fn(() => Promise.resolve([]))
        }
    };
}

export const mockDb = createMockDb();