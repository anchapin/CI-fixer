/**
 * Tracing utilities for instrumenting code with OpenTelemetry
 * Provides helper functions for creating spans, adding events, and setting attributes
 */

import { trace, context, SpanStatusCode, Span, SpanKind } from '@opentelemetry/api';

const tracer = trace.getTracer('ci-fixer-agent', '1.0.0');

export interface SpanOptions {
    attributes?: Record<string, any>;
    kind?: SpanKind;
}

/**
 * Execute a function within a traced span
 * Automatically handles span lifecycle and error recording
 * 
 * @example
 * await withSpan('process-error', async (span) => {
 *   setAttributes(span, { errorType: 'syntax' });
 *   const result = await processError();
 *   return result;
 * });
 */
export async function withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions
): Promise<T> {
    return tracer.startActiveSpan(name, options || {}, async (span) => {
        try {
            // Add attributes if provided
            if (options?.attributes) {
                Object.entries(options.attributes).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        span.setAttribute(key, String(value));
                    }
                });
            }

            const result = await fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message || 'Unknown error',
            });
            span.recordException(error);
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Add an event to the current span
 * Events represent significant moments during span execution
 * 
 * @example
 * addEvent(span, 'file-modified', { path: 'server.ts', lines: 42 });
 */
export function addEvent(span: Span, name: string, attributes?: Record<string, any>) {
    span.addEvent(name, attributes);
}

/**
 * Set multiple attributes on a span
 * Attributes provide context about the operation
 * 
 * @example
 * setAttributes(span, {
 *   'error.category': 'syntax',
 *   'file.path': 'server.ts',
 *   'iteration': 2
 * });
 */
export function setAttributes(span: Span, attributes: Record<string, any>) {
    Object.entries(attributes).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            // Convert objects to JSON strings
            const stringValue = typeof value === 'object'
                ? JSON.stringify(value)
                : String(value);
            span.setAttribute(key, stringValue);
        }
    });
}

/**
 * Get the current active span
 * Useful for adding attributes or events from nested functions
 */
export function getCurrentSpan(): Span | undefined {
    return trace.getActiveSpan();
}

/**
 * Execute a synchronous function within a traced span
 * Similar to withSpan but for synchronous operations
 */
export function withSpanSync<T>(
    name: string,
    fn: (span: Span) => T,
    options?: SpanOptions
): T {
    return tracer.startActiveSpan(name, options || {}, (span) => {
        try {
            if (options?.attributes) {
                Object.entries(options.attributes).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        span.setAttribute(key, String(value));
                    }
                });
            }

            const result = fn(span);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message || 'Unknown error',
            });
            span.recordException(error);
            throw error;
        } finally {
            span.end();
        }
    });
}
