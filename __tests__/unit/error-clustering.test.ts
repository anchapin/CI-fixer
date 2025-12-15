import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupInMemoryDb, getTestDb } from '../helpers/vitest-setup.js';
import {
    clusterError,
    findRecurringPatterns,
    getClusterHistory,
    analyzeClusterTrends,
    getClustersByCategory
} from '../../services/error-clustering.js';

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

describe('ErrorClustering', () => {
    let testRunId: string;

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
    });

    afterEach(async () => {
        const db = getTestDb();
        await db.errorCluster.deleteMany({});
        await db.errorFact.deleteMany({});
        await db.agentRun.deleteMany({});
    });

    describe('clusterError', () => {
        it('should create a new cluster for first occurrence', async () => {
            const db = getTestDb();
            const errorFact = await db.errorFact.create({
                data: {
                    summary: 'TypeError: Cannot read property x',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            const clusterId = await clusterError(
                errorFact.id,
                'runtime',
                'TypeError: Cannot read property x',
                ['test.ts']
            );

            const cluster = await db.errorCluster.findUnique({
                where: { id: clusterId }
            });

            expect(cluster).toBeDefined();
            expect(cluster?.occurrenceCount).toBe(1);
            expect(cluster?.category).toBe('runtime');
        });

        it('should add to existing cluster for similar error', async () => {
            const db = getTestDb();
            const errorFact1 = await db.errorFact.create({
                data: {
                    summary: 'TypeError: Cannot read property 123 of undefined',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            const errorFact2 = await db.errorFact.create({
                data: {
                    summary: 'TypeError: Cannot read property 456 of undefined',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            // First occurrence
            const clusterId1 = await clusterError(
                errorFact1.id,
                'runtime',
                'TypeError: Cannot read property 123 of undefined',
                ['test.ts']
            );

            // Second occurrence (similar error, numbers normalized)
            const clusterId2 = await clusterError(
                errorFact2.id,
                'runtime',
                'TypeError: Cannot read property 456 of undefined',
                ['test.ts']
            );

            // Should be same cluster (normalized fingerprints match)
            expect(clusterId1).toBe(clusterId2);

            const cluster = await db.errorCluster.findUnique({
                where: { id: clusterId1 }
            });

            expect(cluster?.occurrenceCount).toBe(2);
        });

        it('should not add duplicate error fact to cluster', async () => {
            const db = getTestDb();
            const errorFact = await db.errorFact.create({
                data: {
                    summary: 'Test error',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            await clusterError(errorFact.id, 'syntax', 'Test error', ['test.ts']);
            await clusterError(errorFact.id, 'syntax', 'Test error', ['test.ts']);

            const clusters = await db.errorCluster.findMany({});
            expect(clusters).toHaveLength(1);

            const errorFactIds = JSON.parse(clusters[0].errorFactIds);
            expect(errorFactIds).toHaveLength(1);
        });
    });

    describe('findRecurringPatterns', () => {
        it('should find clusters with minimum occurrences', async () => {
            const db = getTestDb();
            // Create multiple error facts and cluster them
            for (let i = 0; i < 3; i++) {
                const errorFact = await db.errorFact.create({
                    data: {
                        summary: `TypeError: Cannot read property x`,
                        filePath: 'test.ts',
                        fixAction: 'edit',
                        runId: testRunId,
                        status: 'open'
                    }
                });

                await clusterError(
                    errorFact.id,
                    'runtime',
                    'TypeError: Cannot read property x',
                    ['test.ts']
                );
            }

            const patterns = await findRecurringPatterns(2);

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns[0].occurrenceCount).toBeGreaterThanOrEqual(2);
        });

        it('should sort by occurrence count descending', async () => {
            const db = getTestDb();
            // Create two different error patterns
            for (let i = 0; i < 5; i++) {
                const errorFact = await db.errorFact.create({
                    data: {
                        summary: `Error A`,
                        filePath: 'a.ts',
                        fixAction: 'edit',
                        runId: testRunId,
                        status: 'open'
                    }
                });
                await clusterError(errorFact.id, 'syntax', 'Error A', ['a.ts']);
            }

            for (let i = 0; i < 3; i++) {
                const errorFact = await db.errorFact.create({
                    data: {
                        summary: `Error B`,
                        filePath: 'b.ts',
                        fixAction: 'edit',
                        runId: testRunId,
                        status: 'open'
                    }
                });
                await clusterError(errorFact.id, 'runtime', 'Error B', ['b.ts']);
            }

            const patterns = await findRecurringPatterns(1);

            expect(patterns[0].occurrenceCount).toBeGreaterThanOrEqual(patterns[1].occurrenceCount);
        });
    });

    describe('getClusterHistory', () => {
        it('should return all error facts in a cluster', async () => {
            const db = getTestDb();
            const errorFact1 = await db.errorFact.create({
                data: {
                    summary: 'Test error',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            const errorFact2 = await db.errorFact.create({
                data: {
                    summary: 'Test error',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'resolved'
                }
            });

            const clusterId = await clusterError(errorFact1.id, 'syntax', 'Test error', ['test.ts']);
            await clusterError(errorFact2.id, 'syntax', 'Test error', ['test.ts']);

            const history = await getClusterHistory(clusterId);

            expect(history).toHaveLength(2);
            expect(history.some(h => h.status === 'open')).toBe(true);
            expect(history.some(h => h.status === 'resolved')).toBe(true);
        });
    });

    describe('analyzeClusterTrends', () => {
        it('should analyze cluster trends', async () => {
            const db = getTestDb();
            const errorFacts = [];
            for (let i = 0; i < 4; i++) {
                const errorFact = await db.errorFact.create({
                    data: {
                        summary: 'Recurring error',
                        filePath: 'test.ts',
                        fixAction: 'edit',
                        runId: testRunId,
                        status: i < 2 ? 'resolved' : 'open'
                    }
                });
                errorFacts.push(errorFact);
            }

            const clusterId = await clusterError(errorFacts[0].id, 'syntax', 'Recurring error', ['test.ts']);
            for (let i = 1; i < errorFacts.length; i++) {
                await clusterError(errorFacts[i].id, 'syntax', 'Recurring error', ['test.ts']);
            }

            const trends = await analyzeClusterTrends(clusterId);

            expect(trends.totalOccurrences).toBe(4);
            expect(trends.resolvedCount).toBe(2);
            expect(trends.unresolvedCount).toBe(2);
            expect(['increasing', 'decreasing', 'stable']).toContain(trends.trend);
        });
    });

    describe('getClustersByCategory', () => {
        it('should return clusters for a specific category', async () => {
            const db = getTestDb();
            const errorFact1 = await db.errorFact.create({
                data: {
                    summary: 'Syntax error',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            const errorFact2 = await db.errorFact.create({
                data: {
                    summary: 'Runtime error',
                    filePath: 'test.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            await clusterError(errorFact1.id, 'syntax', 'Syntax error', ['test.ts']);
            await clusterError(errorFact2.id, 'runtime', 'Runtime error', ['test.ts']);

            const syntaxClusters = await getClustersByCategory('syntax');
            const runtimeClusters = await getClustersByCategory('runtime');

            expect(syntaxClusters).toHaveLength(1);
            expect(runtimeClusters).toHaveLength(1);
        });
    });
});
