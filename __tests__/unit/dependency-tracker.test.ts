import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupInMemoryDb, getTestDb } from '../helpers/vitest-setup.js';
import {
    recordErrorDependency,
    getBlockedErrors,
    getReadyErrors,
    getDiscoveredErrors,
    markErrorInProgress,
    markErrorResolved,
    buildDependencyGraph,
    hasBlockingDependencies
} from '../../services/dependency-tracker.js';

// Mock database client to use test database
vi.mock('../../db/client.js', async () => {
    const { getTestDb } = await import('../helpers/vitest-setup.js');
    return {
        db: new Proxy({}, {
            get(target, prop) {
                const testDb = getTestDb();
                const value = (testDb as any)[prop];
                if (typeof value === 'function') {
                    return value.bind(testDb);
                }
                return value;
            }
        })
    };
});

// Setup test database
setupInMemoryDb();

describe('DependencyTracker', () => {
    let testRunId: string;
    let errorFact1Id: string;
    let errorFact2Id: string;
    let errorFact3Id: string;

    beforeEach(async () => {
        const db = getTestDb();

        // Create test agent run
        const agentRun = await db.agentRun.create({
            data: {
                groupId: 'test-group',
                status: 'working',
                state: '{}'
            }
        });
        testRunId = agentRun.id;

        // Create test error facts
        const errorFact1 = await db.errorFact.create({
            data: {
                summary: 'Test error 1',
                filePath: 'test1.ts',
                fixAction: 'edit',
                runId: testRunId,
                status: 'open'
            }
        });
        errorFact1Id = errorFact1.id;

        const errorFact2 = await db.errorFact.create({
            data: {
                summary: 'Test error 2',
                filePath: 'test2.ts',
                fixAction: 'edit',
                runId: testRunId,
                status: 'open'
            }
        });
        errorFact2Id = errorFact2.id;

        const errorFact3 = await db.errorFact.create({
            data: {
                summary: 'Test error 3',
                filePath: 'test3.ts',
                fixAction: 'command',
                runId: testRunId,
                status: 'open'
            }
        });
        errorFact3Id = errorFact3.id;
    });

    afterEach(async () => {
        const db = getTestDb();

        // Clean up test data
        await db.errorDependency.deleteMany({});
        await db.errorFact.deleteMany({});
        await db.agentRun.deleteMany({});
    });

    describe('recordErrorDependency', () => {
        it('should create a blocks dependency', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact1Id,
                targetErrorId: errorFact2Id,
                relationshipType: 'blocks'
            });

            const db = getTestDb();
            const dependency = await db.errorDependency.findFirst({
                where: {
                    sourceErrorId: errorFact1Id,
                    targetErrorId: errorFact2Id
                }
            });

            expect(dependency).toBeDefined();
            expect(dependency?.relationshipType).toBe('blocks');
        });

        it('should update source error status to blocked when creating blocks relationship', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact1Id,
                targetErrorId: errorFact2Id,
                relationshipType: 'blocks'
            });

            const db = getTestDb();
            const errorFact = await db.errorFact.findUnique({
                where: { id: errorFact1Id }
            });

            expect(errorFact?.status).toBe('blocked');
        });

        it('should create a discovered_from dependency', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact1Id,
                targetErrorId: errorFact2Id,
                relationshipType: 'discovered_from',
                metadata: { context: 'test' }
            });

            const db = getTestDb();
            const dependency = await db.errorDependency.findFirst({
                where: {
                    sourceErrorId: errorFact1Id,
                    targetErrorId: errorFact2Id
                }
            });

            expect(dependency).toBeDefined();
            expect(dependency?.relationshipType).toBe('discovered_from');
            expect(JSON.parse(dependency?.metadata || '{}')).toEqual({ context: 'test' });
        });

        it('should prevent self-dependencies', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact1Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            const db = getTestDb();
            const dependency = await db.errorDependency.findFirst({
                where: {
                    sourceErrorId: errorFact1Id,
                    targetErrorId: errorFact1Id
                }
            });

            expect(dependency).toBeNull();
        });

        it('should not create duplicate dependencies', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact1Id,
                targetErrorId: errorFact2Id,
                relationshipType: 'blocks'
            });

            await recordErrorDependency({
                sourceErrorId: errorFact1Id,
                targetErrorId: errorFact2Id,
                relationshipType: 'blocks'
            });

            const db = getTestDb();
            const dependencies = await db.errorDependency.findMany({
                where: {
                    sourceErrorId: errorFact1Id,
                    targetErrorId: errorFact2Id
                }
            });

            expect(dependencies).toHaveLength(1);
        });
    });

    describe('getBlockedErrors', () => {
        it('should return errors with unresolved blockers', async () => {
            // Error 1 blocks Error 2
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            const blockedErrors = await getBlockedErrors();

            expect(blockedErrors).toHaveLength(1);
            expect(blockedErrors[0].id).toBe(errorFact2Id);
            expect(blockedErrors[0].blockedBy).toHaveLength(1);
            expect(blockedErrors[0].blockedBy[0].id).toBe(errorFact1Id);
        });

        it('should not return errors with resolved blockers', async () => {
            // Error 1 blocks Error 2
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            // Resolve Error 1
            const db = getTestDb();
            await db.errorFact.update({
                where: { id: errorFact1Id },
                data: { status: 'resolved' }
            });

            const blockedErrors = await getBlockedErrors();

            expect(blockedErrors).toHaveLength(0);
        });
    });

    describe('getReadyErrors', () => {
        it('should return errors with no blocking dependencies', async () => {
            const readyErrors = await getReadyErrors(testRunId);

            expect(readyErrors.length).toBeGreaterThan(0);
            expect(readyErrors.every(e => e.blockedBy.filter(b => b.relationshipType === 'blocks').length === 0)).toBe(true);
        });

        it('should not return errors that are blocked', async () => {
            // Error 1 blocks Error 2
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            const readyErrors = await getReadyErrors(testRunId);

            expect(readyErrors.every(e => e.id !== errorFact2Id)).toBe(true);
        });
    });

    describe('getDiscoveredErrors', () => {
        it('should return errors discovered from a source error', async () => {
            // Error 2 was discovered from Error 1
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'discovered_from'
            });

            const discoveredErrors = await getDiscoveredErrors(errorFact1Id);

            expect(discoveredErrors).toHaveLength(1);
            expect(discoveredErrors[0].id).toBe(errorFact2Id);
        });

        it('should return empty array if no discovered errors', async () => {
            const discoveredErrors = await getDiscoveredErrors(errorFact1Id);

            expect(discoveredErrors).toHaveLength(0);
        });
    });

    describe('markErrorResolved', () => {
        it('should mark error as resolved', async () => {
            await markErrorResolved(errorFact1Id, {
                resolution: 'fixed',
                filesChanged: ['test1.ts'],
                iterations: 2,
                finalApproach: 'edit'
            });

            const db = getTestDb();
            const errorFact = await db.errorFact.findUnique({
                where: { id: errorFact1Id }
            });

            expect(errorFact?.status).toBe('resolved');
        });

        it('should unblock dependent errors when resolved', async () => {
            // Error 1 blocks Error 2
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            // Resolve Error 1
            await markErrorResolved(errorFact1Id);

            const db = getTestDb();
            const errorFact2 = await db.errorFact.findUnique({
                where: { id: errorFact2Id }
            });

            expect(errorFact2?.status).toBe('open');
        });

        it('should not unblock errors with other unresolved blockers', async () => {
            // Error 1 and Error 3 both block Error 2
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact3Id,
                relationshipType: 'blocks'
            });

            // Resolve only Error 1
            await markErrorResolved(errorFact1Id);

            const db = getTestDb();
            const errorFact2 = await db.errorFact.findUnique({
                where: { id: errorFact2Id }
            });

            // Should still be blocked by Error 3
            expect(errorFact2?.status).toBe('blocked');
        });
    });

    describe('buildDependencyGraph', () => {
        it('should build a graph with nodes and edges', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            const graph = await buildDependencyGraph(testRunId);

            expect(graph.nodes.length).toBeGreaterThan(0);
            expect(graph.edges.length).toBeGreaterThan(0);
            expect(graph.edges[0].type).toBe('blocks');
        });
    });

    describe('hasBlockingDependencies', () => {
        it('should return true if error has unresolved blockers', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            const hasBlockers = await hasBlockingDependencies(errorFact2Id);

            expect(hasBlockers).toBe(true);
        });

        it('should return false if error has no blockers', async () => {
            const hasBlockers = await hasBlockingDependencies(errorFact1Id);

            expect(hasBlockers).toBe(false);
        });

        it('should return false if blockers are resolved', async () => {
            await recordErrorDependency({
                sourceErrorId: errorFact2Id,
                targetErrorId: errorFact1Id,
                relationshipType: 'blocks'
            });

            const db = getTestDb();
            await db.errorFact.update({
                where: { id: errorFact1Id },
                data: { status: 'resolved' }
            });

            const hasBlockers = await hasBlockingDependencies(errorFact2Id);

            expect(hasBlockers).toBe(false);
        });
    });
});
