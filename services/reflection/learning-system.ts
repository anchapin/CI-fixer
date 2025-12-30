/**
 * Reflection & Learning Module
 * Implements self-improvement mechanisms for continuous learning
 * Based on "Code Generation Agents" survey - reflection mechanisms
 */

import { db } from '../../db/client.js';
import { WriteQueue } from './write-queue.js';
import * as Metrics from '../../telemetry/metrics.js';

export interface FailurePattern {
    id: string;
    errorType: string;
    failureReason: string;
    attemptedFix: string;
    context: string;
    frequency: number;
    firstSeen: number;
    lastSeen: number;
}

export interface LearningInsight {
    pattern: string;
    recommendation: string;
    confidence: number;
    evidence: string[];
}

export interface ReflectionResult {
    insights: LearningInsight[];
    patternsIdentified: number;
    improvementSuggestions: string[];
}

/**
 * Reflection & Learning System
 */
export class ReflectionLearningSystem {
    private failurePatterns: Map<string, FailurePattern> = new Map();
    private successPatterns: Map<string, any> = new Map();
    private learningHistory: Array<{ timestamp: number; insight: string }> = [];
    private persistence = new PersistentLearning();
    private isInitialized = false;

    /**
     * Initialize the system by loading historical data
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            const data = await this.persistence.load();
            if (data) {
                // Hydrate failure patterns
                data.failures.forEach((f: any) => {
                    this.failurePatterns.set(f.id, {
                        ...f,
                        firstSeen: f.firstSeen.getTime(),
                        lastSeen: f.lastSeen.getTime()
                    });
                });

                // Hydrate success patterns
                data.successes.forEach((s: any) => {
                    this.successPatterns.set(s.id, {
                        ...s,
                        timestamp: s.timestamp.getTime()
                    });
                });

                console.log(`[Learning] Loaded ${this.failurePatterns.size} failure patterns and ${this.successPatterns.size} success patterns.`);
            }
            this.isInitialized = true;
        } catch (error) {
            console.error('[Learning] Failed to initialize persistence:', error);
            this.isInitialized = true; // Still mark as initialized to avoid retry loops
        }
    }

    /**
     * Record a failure for learning
     */
    async recordFailure(
        errorType: string,
        failureReason: string,
        attemptedFix: string,
        context: string
    ): Promise<void> {
        // Ensure we are initialized
        if (!this.isInitialized) await this.initialize();

        const patternId = this.generatePatternId(errorType, failureReason);
        const now = Date.now();

        let pattern = this.failurePatterns.get(patternId);

        if (pattern) {
            pattern.frequency++;
            pattern.lastSeen = now;
        } else {
            pattern = {
                id: patternId,
                errorType,
                failureReason,
                attemptedFix,
                context,
                frequency: 1,
                firstSeen: now,
                lastSeen: now
            };
            this.failurePatterns.set(patternId, pattern);
        }

        // Persist immediately (fire & forget)
        this.persistence.saveFailure(pattern).catch(e =>
            console.warn('[Learning] Failed to persist failure pattern:', e)
        );
    }

    /**
     * Record a success for learning
     */
    async recordSuccess(
        errorType: string,
        successfulFix: string,
        context: string
    ): Promise<void> {
        // Ensure we are initialized
        if (!this.isInitialized) await this.initialize();

        const patternId = this.generatePatternId(errorType, 'success');

        const successItem = {
            errorType,
            successfulFix,
            context,
            timestamp: Date.now()
        };

        this.successPatterns.set(patternId, successItem);

        // Persist immediately (fire & forget)
        this.persistence.saveSuccess(patternId, successItem).catch(e =>
            console.warn('[Learning] Failed to persist success pattern:', e)
        );
    }

    /**
     * Perform reflection and extract insights
     */
    reflect(): ReflectionResult {
        const insights: LearningInsight[] = [];
        const improvementSuggestions: string[] = [];

        // Analyze failure patterns
        const frequentFailures = Array.from(this.failurePatterns.values())
            .filter(p => p.frequency >= 3)
            .sort((a, b) => b.frequency - a.frequency);

        for (const pattern of frequentFailures) {
            // Generate insight from pattern
            const insight = this.generateInsight(pattern);
            insights.push(insight);

            // Generate improvement suggestion
            const suggestion = this.generateSuggestion(pattern);
            if (suggestion) {
                improvementSuggestions.push(suggestion);
            }
        }

        // Compare failures vs successes
        const failureRate = this.calculateFailureRate();
        if (failureRate > 0.5) {
            improvementSuggestions.push(
                'High failure rate detected. Consider reviewing error classification logic.'
            );
        }

        return {
            insights,
            patternsIdentified: frequentFailures.length,
            improvementSuggestions
        };
    }

    /**
     * Extract learnings from iteration history
     */
    extractLearnings(iterations: Array<{
        success: boolean;
        errorType: string;
        approach: string;
        feedback: string;
    }>): string[] {
        const learnings: string[] = [];

        // Group by error type
        const byType = new Map<string, typeof iterations>();
        for (const iter of iterations) {
            if (!byType.has(iter.errorType)) {
                byType.set(iter.errorType, []);
            }
            byType.get(iter.errorType)!.push(iter);
        }

        // Analyze each error type
        for (const [errorType, iters] of byType) {
            const successes = iters.filter(i => i.success);
            const failures = iters.filter(i => !i.success);

            if (successes.length > 0) {
                learnings.push(
                    `For ${errorType}: ${successes[0].approach} was successful`
                );
            }

            if (failures.length > 2) {
                learnings.push(
                    `For ${errorType}: Avoid ${failures[0].approach} (failed ${failures.length} times)`
                );
            }
        }

        return learnings;
    }

    /**
     * Get statistics
     */
    getStats(): {
        totalFailurePatterns: number;
        totalSuccessPatterns: number;
        mostCommonFailure: string | null;
        failureRate: number;
    } {
        const mostCommon = Array.from(this.failurePatterns.values())
            .sort((a, b) => b.frequency - a.frequency)[0];

        return {
            totalFailurePatterns: this.failurePatterns.size,
            totalSuccessPatterns: this.successPatterns.size,
            mostCommonFailure: mostCommon?.failureReason || null,
            failureRate: this.calculateFailureRate()
        };
    }

    /**
     * Clear old patterns (retention policy)
     */
    clearOldPatterns(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): void {
        const now = Date.now();

        for (const [id, pattern] of this.failurePatterns) {
            if (now - pattern.lastSeen > maxAgeMs) {
                this.failurePatterns.delete(id);
            }
        }
    }

    // Private helper methods

    private generatePatternId(errorType: string, reason: string): string {
        return `${errorType}:${reason}`.toLowerCase().replace(/\s+/g, '-');
    }

    private generateInsight(pattern: FailurePattern): LearningInsight {
        return {
            pattern: `${pattern.errorType} failures`,
            recommendation: `Review approach for ${pattern.failureReason}`,
            confidence: Math.min(0.9, pattern.frequency / 10),
            evidence: [
                `Failed ${pattern.frequency} times`,
                `Last seen: ${new Date(pattern.lastSeen).toISOString()}`
            ]
        };
    }

    private generateSuggestion(pattern: FailurePattern): string | null {
        if (pattern.frequency >= 5) {
            return `Consider alternative approach for ${pattern.errorType} - current method failing frequently`;
        }
        return null;
    }

    private calculateFailureRate(): number {
        const total = this.failurePatterns.size + this.successPatterns.size;
        return total > 0 ? this.failurePatterns.size / total : 0;
    }
}

/**
 * Persistent learning storage with write queue and retry logic
 */
export class PersistentLearning {
    private writeQueue: WriteQueue;
    private telemetry = {
        successCount: 0,
        failureCount: 0,
        retryCount: 0
    };

    constructor() {
        this.writeQueue = new WriteQueue();
    }

    async load() {
        try {
            const [failures, successes] = await Promise.all([
                db.learningFailure.findMany(),
                db.learningSuccess.findMany()
            ]);

            // Record telemetry
            Metrics.learningPatternLoad.add(failures.length + successes.length, {
                type: 'failure'
            });
            Metrics.learningPatternLoad.add(successes.length, {
                type: 'success'
            });

            return { failures, successes };
        } catch (error) {
            console.error('Failed to load learning data from DB:', error);
            Metrics.learningPatternSaveError.add(1, {
                operation: 'load',
                error: error instanceof Error ? error.name : 'unknown'
            });
            return null;
        }
    }

    async saveFailure(pattern: FailurePattern): Promise<void> {
        const startTime = Date.now();
        await this.writeQueue.enqueue(async () => {
            await db.learningFailure.upsert({
                where: { id: pattern.id },
                create: {
                    id: pattern.id,
                    errorType: pattern.errorType,
                    failureReason: pattern.failureReason,
                    attemptedFix: pattern.attemptedFix,
                    context: pattern.context,
                    frequency: pattern.frequency,
                    firstSeen: new Date(pattern.firstSeen),
                    lastSeen: new Date(pattern.lastSeen)
                },
                update: {
                    frequency: pattern.frequency,
                    lastSeen: new Date(pattern.lastSeen),
                    // Optionally update context or fix if it changes
                }
            });
            this.telemetry.successCount++;
            Metrics.learningPatternSave.add(1, { type: 'failure' });
            Metrics.learningWriteLatency.record(Date.now() - startTime, { type: 'failure' });
            console.log(`[Learning] Persisted failure pattern: ${pattern.id}`);
        });
    }

    async saveSuccess(id: string, item: any): Promise<void> {
        const startTime = Date.now();
        await this.writeQueue.enqueue(async () => {
            await db.learningSuccess.upsert({
                where: { id },
                create: {
                    id,
                    errorType: item.errorType,
                    successfulFix: item.successfulFix,
                    context: item.context,
                    timestamp: new Date(item.timestamp)
                },
                update: {
                    // Successes might just need timestamp updates or ignore if immutable
                    timestamp: new Date(item.timestamp)
                }
            });
            this.telemetry.successCount++;
            Metrics.learningPatternSave.add(1, { type: 'success' });
            Metrics.learningWriteLatency.record(Date.now() - startTime, { type: 'success' });
            console.log(`[Learning] Persisted success pattern: ${id}`);
        });
    }

    /**
     * Get telemetry statistics (for monitoring)
     */
    getTelemetry() {
        const queueSize = this.writeQueue.getQueueSize();
        // Record queue size to gauge metric
        Metrics.learningQueueSize.record(queueSize);

        return {
            ...this.telemetry,
            queueSize,
            isQueueActive: this.writeQueue.isActive()
        };
    }

    /**
     * Flush any pending write operations
     * Useful for tests to ensure all writes are complete before assertions
     */
    async flush(): Promise<void> {
        await this.writeQueue.flush();
    }
}

/**
 * Global reflection system instance
 */
let globalReflection: ReflectionLearningSystem | null = null;

export function getReflectionSystem(): ReflectionLearningSystem {
    if (!globalReflection) {
        globalReflection = new ReflectionLearningSystem();
    }
    return globalReflection;
}
