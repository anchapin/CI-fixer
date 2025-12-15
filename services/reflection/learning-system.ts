/**
 * Reflection & Learning Module
 * Implements self-improvement mechanisms for continuous learning
 * Based on "Code Generation Agents" survey - reflection mechanisms
 */

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

    /**
     * Record a failure for learning
     */
    recordFailure(
        errorType: string,
        failureReason: string,
        attemptedFix: string,
        context: string
    ): void {
        const patternId = this.generatePatternId(errorType, failureReason);

        const existing = this.failurePatterns.get(patternId);
        if (existing) {
            existing.frequency++;
            existing.lastSeen = Date.now();
        } else {
            this.failurePatterns.set(patternId, {
                id: patternId,
                errorType,
                failureReason,
                attemptedFix,
                context,
                frequency: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now()
            });
        }
    }

    /**
     * Record a success for learning
     */
    recordSuccess(
        errorType: string,
        successfulFix: string,
        context: string
    ): void {
        const patternId = this.generatePatternId(errorType, 'success');

        this.successPatterns.set(patternId, {
            errorType,
            successfulFix,
            context,
            timestamp: Date.now()
        });
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
 * Persistent learning storage
 */
export class PersistentLearning {
    private storageKey = 'ci-fixer-learning';

    /**
     * Save learning data
     */
    save(data: any): void {
        try {
            // In a real implementation, this would save to database or file
            const serialized = JSON.stringify(data);
            // localStorage.setItem(this.storageKey, serialized);
        } catch (error) {
            console.warn('Failed to save learning data:', error);
        }
    }

    /**
     * Load learning data
     */
    load(): any | null {
        try {
            // In a real implementation, this would load from database or file
            // const serialized = localStorage.getItem(this.storageKey);
            // return serialized ? JSON.parse(serialized) : null;
            return null;
        } catch (error) {
            console.warn('Failed to load learning data:', error);
            return null;
        }
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
