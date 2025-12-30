/**
 * Write Queue for Serialized Database Operations
 *
 * SQLite has limited concurrency support (single-writer design).
 * This queue serializes write operations to prevent database lock timeouts.
 */

import * as Metrics from '../../telemetry/metrics.js';

export interface QueueOperation {
    fn: () => Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class WriteQueue {
    private queue: QueueOperation[] = [];
    private isProcessing = false;
    private maxRetries = 3;
    private baseDelayMs = 100;
    private pendingFlush: Array<() => void> = [];

    /**
     * Add a write operation to the queue
     */
    async enqueue<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push({
                fn: async () => { await fn(); },
                resolve: () => resolve(),
                reject
            });

            this.processQueue();
        });
    }

    /**
     * Wait for all queued operations to complete
     * Useful for tests to ensure all writes are flushed before assertions
     */
    async flush(): Promise<void> {
        if (this.isProcessing || this.queue.length > 0) {
            await new Promise<void>(resolve => {
                this.pendingFlush.push(resolve);
            });
        }
    }

    /**
     * Process the queue sequentially
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const operation = this.queue.shift();
            if (!operation) break;

            try {
                await this.executeWithRetry(operation.fn);
                operation.resolve();
            } catch (error) {
                operation.reject(error);
            }
        }

        this.isProcessing = false;

        // Notify any waiting flush operations
        if (this.queue.length === 0 && this.pendingFlush.length > 0) {
            const flushCallbacks = this.pendingFlush.splice(0);
            flushCallbacks.forEach(cb => cb());
        }
    }

    /**
     * Execute operation with exponential backoff retry
     */
    private async executeWithRetry(fn: () => Promise<void>): Promise<void> {
        let lastError: unknown;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                await fn();
                return;
            } catch (error) {
                lastError = error;

                // Record timeout errors for monitoring
                if (this.isRetryableError(error)) {
                    Metrics.learningDatabaseTimeout.add(1, {
                        attempt: attempt.toString(),
                        error: error instanceof Error ? error.name : 'unknown'
                    });
                }

                // Check if this is a retryable error
                if (!this.isRetryableError(error)) {
                    throw error;
                }

                // Don't retry on the last attempt
                if (attempt < this.maxRetries) {
                    const delay = this.baseDelayMs * Math.pow(2, attempt);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError;
    }

    /**
     * Check if error is retryable (database timeout, lock, etc.)
     */
    private isRetryableError(error: unknown): boolean {
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            const code = (error as any).code;

            // Prisma error codes
            if (code === 'P1008' || code === 'P2034') {
                return true; // Timeout / Connection
            }

            // SQLite lock messages
            if (message.includes('database is locked') ||
                message.includes('sqlite_busy') ||
                message.includes('database file is locked')) {
                return true;
            }

            // Network timeout
            if (message.includes('timeout') || message.includes('timed out')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current queue size (for monitoring)
     */
    getQueueSize(): number {
        return this.queue.length;
    }

    /**
     * Check if queue is currently processing
     */
    isActive(): boolean {
        return this.isProcessing;
    }
}
