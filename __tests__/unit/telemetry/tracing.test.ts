
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tracing from '../../../telemetry/tracing.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';

// Mock OpenTelemetry API
vi.mock('@opentelemetry/api', () => {
    const mockSpan = {
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
        addEvent: vi.fn(),
    };

    const mockTracer = {
        startActiveSpan: vi.fn((name, options, callback) => {
            // Check if callback is the second arg (options omitted) or third
            const cb = typeof options === 'function' ? options : callback;
            return cb(mockSpan);
        }),
    };

    return {
        trace: {
            getTracer: vi.fn(() => mockTracer),
            getActiveSpan: vi.fn(() => mockSpan),
        },
        context: {
            active: vi.fn(),
        },
        SpanStatusCode: {
            OK: 1,
            ERROR: 2,
        },
        SpanKind: {
            INTERNAL: 0,
            SERVER: 1,
            CLIENT: 2,
            PRODUCER: 3,
            CONSUMER: 4,
        }
    };
});

describe('Tracing Utility', () => {
    let mockSpan: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Get the mock span instance from the mock factory results (via getActiveSpan for convenience in asserting)
        mockSpan = trace.getActiveSpan() as any;
    });

    describe('withSpan', () => {
        it('should execute function within a span and set status OK on success', async () => {
            const result = await tracing.withSpan('test-span', async (span) => {
                return 'success';
            });

            expect(result).toBe('success');
            const tracer = trace.getTracer('test');
            expect(tracer.startActiveSpan).toHaveBeenCalledWith('test-span', {}, expect.any(Function));
            expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
            expect(mockSpan.end).toHaveBeenCalled();
        });

        it('should record exception and set status ERROR on failure', async () => {
            const error = new Error('Test error');
            await expect(tracing.withSpan('test-span', async (span) => {
                throw error;
            })).rejects.toThrow('Test error');

            expect(mockSpan.recordException).toHaveBeenCalledWith(error);
            expect(mockSpan.setStatus).toHaveBeenCalledWith({
                code: SpanStatusCode.ERROR,
                message: 'Test error'
            });
            expect(mockSpan.end).toHaveBeenCalled();
        });

        it('should set initial attributes if provided', async () => {
            await tracing.withSpan('test-span', async () => { }, {
                attributes: { 'test.attr': 'value' }
            });

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('test.attr', 'value');
        });
    });

    describe('withSpanSync', () => {
        it('should execute synchronous function within a span', () => {
            const result = tracing.withSpanSync('test-span-sync', (span) => {
                return 'sync-success';
            });

            expect(result).toBe('sync-success');
            expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
            expect(mockSpan.end).toHaveBeenCalled();
        });

        it('should handle errors in synchronous execution', () => {
            const error = new Error('Sync error');
            expect(() => tracing.withSpanSync('test-span-sync', () => {
                throw error;
            })).toThrow('Sync error');

            expect(mockSpan.recordException).toHaveBeenCalledWith(error);
            expect(mockSpan.end).toHaveBeenCalled();
        });
    });

    describe('Helper Functions', () => {
        it('should add events to span', () => {
            tracing.addEvent(mockSpan, 'test-event', { detail: 'something' });
            expect(mockSpan.addEvent).toHaveBeenCalledWith('test-event', { detail: 'something' });
        });

        it('should set multiple attributes', () => {
            tracing.setAttributes(mockSpan, {
                'string': 'val',
                'number': 123,
                'object': { nested: true },
                'null': null,
                'undefined': undefined
            });

            expect(mockSpan.setAttribute).toHaveBeenCalledWith('string', 'val');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith('number', '123');
            expect(mockSpan.setAttribute).toHaveBeenCalledWith('object', '{"nested":true}');
            // Should NOT call for null/undefined
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('null', expect.anything());
            expect(mockSpan.setAttribute).not.toHaveBeenCalledWith('undefined', expect.anything());
        });

        it('should get current span', () => {
            const span = tracing.getCurrentSpan();
            expect(trace.getActiveSpan).toHaveBeenCalled();
            expect(span).toBe(mockSpan);
        });
    });
});
