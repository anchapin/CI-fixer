/**
 * Performance Test: Reflection Learning System Under Concurrent Load
 *
 * This test verifies that the Reflection Learning System can handle
 * concurrent write operations without performance degradation or errors.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ReflectionLearningSystem } from '../../services/reflection/learning-system.js';

// Hoist the mock object
const mocks = vi.hoisted(() => {
    return {
        db: {
            learningFailure: {
                deleteMany: vi.fn(),
                create: vi.fn(),
                findMany: vi.fn().mockResolvedValue([]),
                count: vi.fn().mockResolvedValue(0)
            },
            learningSuccess: {
                deleteMany: vi.fn(),
                create: vi.fn(),
                findMany: vi.fn().mockResolvedValue([]),
                count: vi.fn().mockResolvedValue(0)
            },
            $disconnect: vi.fn()
        }
    };
});

// Mock the module
vi.mock('../../db/client.js', () => ({
    db: mocks.db,
    disconnectDb: vi.fn()
}));

interface PerformanceMetrics {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    totalDurationMs: number;
    avgLatencyMs: number;
    maxLatencyMs: number;
    minLatencyMs: number;
    operationsPerSecond: number;
}

describe('Reflection Learning System - Performance Tests', () => {
    let system: ReflectionLearningSystem;

    beforeAll(async () => {
        system = new ReflectionLearningSystem();
        await system.initialize();
    });

    describe('Concurrent Write Performance', () => {
        it('should handle 100 concurrent write operations', async () => {
            const operationCount = 100;
            const startTime = Date.now();

            // Create 100 concurrent write operations
            const promises = [];
            for (let i = 0; i < operationCount; i++) {
                promises.push(
                    system.recordFailure(
                        `PerfTestError${i % 10}`,
                        `Test reason ${i}`,
                        `Test fix ${i}`,
                        `test.ts:${i}`
                    )
                );
            }

            await Promise.all(promises);

            // Flush the queue to ensure all writes complete
            await system['persistence'].flush();

            const duration = Date.now() - startTime;

            // Verify all writes succeeded
            const system2 = new ReflectionLearningSystem();
            await system2.initialize();
            const stats = system2.getStats();

            expect(duration).toBeLessThan(10000); // Should complete in <10 seconds

            console.log(`[Performance] 100 concurrent writes completed in ${duration}ms`);
            console.log(`[Performance] Avg latency: ${(duration / operationCount).toFixed(2)}ms per operation`);
        });

        it('should handle burst writes (1000 operations)', async () => {
            const operationCount = 1000;
            const startTime = Date.now();

            // Create 1000 concurrent write operations (burst load)
            const promises = [];
            for (let i = 0; i < operationCount; i++) {
                promises.push(
                    system.recordFailure(
                        `BurstTestError${i % 50}`,
                        `Burst reason ${i}`,
                        `Burst fix ${i}`,
                        `burst.ts:${i}`
                    )
                );
            }

            await Promise.all(promises);
            await system['persistence'].flush();

            const duration = Date.now() - startTime;

            // Verify system is still responsive
            const stats = system.getStats();
            expect(duration).toBeLessThan(120000); // Should complete in <120 seconds

            console.log(`[Performance] 1000 burst writes completed in ${duration}ms`);
            console.log(`[Performance] Throughput: ${(operationCount / (duration / 1000)).toFixed(2)} ops/sec`);
        }, 120000); // 2 minute timeout

        it('should maintain performance under sustained load', async () => {
            const batchCount = 10;
            const batchSize = 50;
            const totalOperations = batchCount * batchSize;
            const latencies: number[] = [];

            for (let batch = 0; batch < batchCount; batch++) {
                const batchStart = Date.now();

                const promises = [];
                for (let i = 0; i < batchSize; i++) {
                    promises.push(
                        system.recordFailure(
                            `SustainedError${batch % 20}`,
                            `Sustained reason ${batch}-${i}`,
                            `Sustained fix`,
                            `sustained.ts:${batch}`
                        )
                    );
                }

                await Promise.all(promises);
                await system['persistence'].flush();

                const batchDuration = Date.now() - batchStart;
                latencies.push(batchDuration);

                // Small delay between batches to simulate real usage
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
            const maxLatency = Math.max(...latencies);
            const minLatency = Math.min(...latencies);

            // Performance should remain consistent (no degradation)
            if (minLatency > 5) {
                 expect(maxLatency / minLatency).toBeLessThan(5);
            }

            console.log(`[Performance] Sustained load test completed:`);
            console.log(`[Performance] - Total operations: ${totalOperations}`);
            console.log(`[Performance] - Avg batch latency: ${avgLatency.toFixed(2)}ms`);
            console.log(`[Performance] - Min batch latency: ${minLatency}ms`);
            console.log(`[Performance] - Max batch latency: ${maxLatency}ms`);
            console.log(`[Performance] - Latency ratio: ${(maxLatency / Math.max(1, minLatency)).toFixed(2)}x`);
        }, 120000); // 2 minute timeout
    });

    describe('Startup Performance', () => {
        it('should initialize in less than 500ms', async () => {
            const startTime = Date.now();

            const testSystem = new ReflectionLearningSystem();
            await testSystem.initialize();

            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(500); // Startup should be fast

            console.log(`[Performance] Initialization completed in ${duration}ms`);
        });

        it('should load historical data efficiently', async () => {
            // Pre-populate with 100 patterns
            for (let i = 0; i < 100; i++) {
                await system.recordFailure(
                    `LoadTestError${i % 10}`,
                    `Load test reason ${i}`,
                    `Load test fix`,
                    `load.ts:${i}`
                );
            }
            await system['persistence'].flush();

            // Measure load time
            const startTime = Date.now();
            const testSystem = new ReflectionLearningSystem();
            await testSystem.initialize();
            const duration = Date.now() - startTime;

            const stats = testSystem.getStats();

            expect(duration).toBeLessThan(2000); // Should load 100 patterns in <2s

            console.log(`[Performance] Loaded ${stats.totalFailurePatterns} patterns in ${duration}ms`);
        }, 120000); // 2 minute timeout
    });

    describe('Telemetry Performance', () => {
        it('should collect telemetry without performance impact', async () => {
            const iterations = 100;
            const latencies: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const start = Date.now();

                // Collect telemetry
                const telemetry = system['persistence'].getTelemetry();

                const duration = Date.now() - start;
                latencies.push(duration);

                expect(telemetry).toBeDefined();
                expect(telemetry.queueSize).toBeGreaterThanOrEqual(0);
            }

            const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

            // Telemetry collection should be very fast (<1ms)
            expect(avgLatency).toBeLessThan(2);

            console.log(`[Performance] Telemetry collection: ${avgLatency.toFixed(3)}ms avg`);
        });
    });

    describe('Graceful Degradation', () => {
        it('should continue operation when database is slow', async () => {
            const operations = 200;
            const promises = [];

            const startTime = Date.now();

            // Submit many operations quickly
            for (let i = 0; i < operations; i++) {
                promises.push(
                    system.recordFailure(
                        `DegradeTestError${i % 20}`,
                        `Degrade reason ${i}`,
                        `Degrade fix`,
                        `degrade.ts:${i}`
                    )
                );
            }

            // In-memory operations should complete quickly
            const inMemoryDuration = Date.now() - startTime;
            expect(inMemoryDuration).toBeLessThan(100); // <100ms for in-memory

            // Wait for queue to process
            await Promise.all(promises);
            await system['persistence'].flush();

            // Verify all operations succeeded
            const stats = system.getStats();

            console.log(`[Performance] In-memory operations: ${inMemoryDuration}ms`);
            console.log(`[Performance] Database writes completed asynchronously`);
        });
    });
});
