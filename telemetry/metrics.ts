/**
 * Metrics collection for CI-Fixer
 * Tracks fix attempts, success rates, durations, and token usage
 */

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('ci-fixer-agent', '1.0.0');

// Counters - Track total occurrences
export const fixAttempts = meter.createCounter('fix_attempts_total', {
    description: 'Total number of fix attempts',
    unit: '1'
});

export const fixSuccesses = meter.createCounter('fix_successes_total', {
    description: 'Total number of successful fixes',
    unit: '1'
});

export const fixFailures = meter.createCounter('fix_failures_total', {
    description: 'Total number of failed fixes',
    unit: '1'
});

export const llmCalls = meter.createCounter('llm_calls_total', {
    description: 'Total number of LLM API calls',
    unit: '1'
});

// Histograms - Track distributions
export const fixDuration = meter.createHistogram('fix_duration_seconds', {
    description: 'Duration of fix attempts in seconds',
    unit: 's'
});

export const llmTokens = meter.createHistogram('llm_tokens_used', {
    description: 'Number of tokens used per LLM call',
    unit: '1'
});

export const iterationsPerFix = meter.createHistogram('iterations_per_fix', {
    description: 'Number of iterations per fix attempt',
    unit: '1'
});

export const llmLatency = meter.createHistogram('llm_latency_ms', {
    description: 'LLM API call latency in milliseconds',
    unit: 'ms'
});

export const loopDetected = meter.createCounter('loop_detected_total', {
    description: 'Total number of detected agent loops',
    unit: '1'
});

export const reproductionInferred = meter.createCounter('reproduction_inferred_total', {
    description: 'Total number of reproduction commands inferred',
    unit: '1'
});

// ============================================================================
// REFLECTION LEARNING SYSTEM METRICS
// ============================================================================

export const learningPatternSave = meter.createCounter('learning_pattern_save_total', {
    description: 'Total number of learning patterns saved to database',
    unit: '1'
});

export const learningPatternSaveError = meter.createCounter('learning_pattern_save_error_total', {
    description: 'Total number of errors saving learning patterns',
    unit: '1'
});

export const learningPatternLoad = meter.createCounter('learning_pattern_load_total', {
    description: 'Total number of learning patterns loaded from database',
    unit: '1'
});

export const learningDatabaseTimeout = meter.createCounter('learning_database_timeout_total', {
    description: 'Total number of database timeout errors',
    unit: '1'
});

export const learningQueueSize = meter.createGauge('learning_queue_size', {
    description: 'Current size of the write queue',
    unit: '1'
});

export const learningWriteLatency = meter.createHistogram('learning_write_latency_ms', {
    description: 'Latency of database write operations in milliseconds',
    unit: 'ms'
});

/**
 * Record a fix attempt with its outcome
 */
export function recordFixAttempt(
    success: boolean,
    duration: number,
    iterations: number,
    category: string
) {
    const attributes = { category, success: success.toString() };

    fixAttempts.add(1, { category });

    if (success) {
        fixSuccesses.add(1, { category });
    } else {
        fixFailures.add(1, { category });
    }

    fixDuration.record(duration, attributes);
    iterationsPerFix.record(iterations, attributes);
}

/**
 * Record a detected loop
 */
export function recordLoopDetected(
    duplicateOfIteration: number,
    hash: string
) {
    loopDetected.add(1, { 
        duplicate_of: duplicateOfIteration.toString(),
        hash_prefix: hash.substring(0, 8)
    });
}

/**
 * Record a reproduction command inference
 */
export function recordReproductionInference(
    strategy: string,
    success: boolean
) {
    reproductionInferred.add(1, { 
        strategy,
        success: success.toString()
    });
}

/**
 * Record an LLM API call
 */
export function recordLLMCall(
    provider: string,
    model: string,
    tokens: number,
    latencyMs: number,
    success: boolean
) {
    const attributes = { provider, model, success: success.toString() };

    llmCalls.add(1, attributes);
    llmTokens.record(tokens, attributes);
    llmLatency.record(latencyMs, attributes);
}

/**
 * Get metrics summary (for logging/debugging)
 * Note: OpenTelemetry doesn't provide direct metric reading,
 * this is a placeholder for future metric export functionality
 */
export function getMetricsSummary(): string {
    return '[Metrics] Metrics are being collected. Use OTEL exporter to view.';
}
