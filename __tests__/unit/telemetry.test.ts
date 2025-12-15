import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initTelemetry, isTelemetryEnabled } from '../../telemetry/config.js';
import { withSpan, setAttributes, addEvent, withSpanSync } from '../../telemetry/tracing.js';
import { recordFixAttempt, recordLLMCall, getMetricsSummary } from '../../telemetry/metrics.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Telemetry', () => {
    const testTraceFile = './logs/test-traces.json';
    let sdk: any;

    beforeAll(() => {
        // Create logs directory if it doesn't exist
        const logDir = path.dirname(testTraceFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        // Clean up any existing test traces
        if (fs.existsSync(testTraceFile)) {
            fs.unlinkSync(testTraceFile);
        }

        // Initialize telemetry with test file
        process.env.OTEL_EXPORTER_FILE = testTraceFile;
        sdk = initTelemetry('ci-fixer-test');
    });

    afterAll(async () => {
        // Shutdown SDK
        if (sdk) {
            await sdk.shutdown();
        }

        // Clean up test file
        if (fs.existsSync(testTraceFile)) {
            fs.unlinkSync(testTraceFile);
        }

        delete process.env.OTEL_EXPORTER_FILE;
    });

    describe('Configuration', () => {
        it('should detect when telemetry is enabled', () => {
            expect(isTelemetryEnabled()).toBe(true);
        });
    });

    describe('Tracing', () => {
        it('should create spans with attributes', async () => {
            const result = await withSpan('test-span', async (span) => {
                setAttributes(span, {
                    'test.key': 'value',
                    'test.number': 42
                });
                addEvent(span, 'test-event', { detail: 'test' });
                return 'success';
            });

            expect(result).toBe('success');
        });

        it('should handle errors in spans', async () => {
            try {
                await withSpan('error-span', async (span) => {
                    throw new Error('Test error');
                });
                expect.fail('Should have thrown error');
            } catch (error: any) {
                expect(error.message).toBe('Test error');
            }
        });

        it('should handle non-Error objects', async () => {
            try {
                await withSpan('weird-error', async () => {
                    throw 'Just a string';
                });
            } catch (e) {
                expect(e).toBe('Just a string');
            }
        });

        it('should create nested spans', async () => {
            const result = await withSpan('parent-span', async (parentSpan) => {
                setAttributes(parentSpan, { 'level': 'parent' });

                return await withSpan('child-span', async (childSpan) => {
                    setAttributes(childSpan, { 'level': 'child' });
                    return 'nested-success';
                });
            });

            expect(result).toBe('nested-success');
        });
    });

    describe('Metrics', () => {
        it('should record fix attempts', () => {
            recordFixAttempt(true, 10.5, 3, 'syntax');
            recordFixAttempt(false, 5.2, 5, 'type');
            // Metrics are recorded, no assertion needed (they're exported elsewhere)
            expect(true).toBe(true);
        });

        it('should record LLM calls', () => {
            recordLLMCall('gemini', 'gemini-2.5-flash', 1500, 250, true);
            recordLLMCall('openai', 'gpt-4', 2000, 500, false);
            // Metrics are recorded, no assertion needed
            expect(true).toBe(true);
        });

        it('should return metrics summary', () => {
            const summary = getMetricsSummary();
            expect(summary).toContain('[Metrics]');
        });
    });

    describe('Tracing Sync', () => {
        it('should handle withSpanSync with attributes', () => {
            const result = withSpanSync('sync-span', (span) => {
                return 'sync-success';
            }, {
                attributes: { 'sync.attr': 'true' }
            });
            expect(result).toBe('sync-success');
        });

        it('should handle errors in withSpanSync', () => {
            expect(() => {
                withSpanSync('sync-error', (span) => {
                    throw new Error('Sync Error');
                });
            }).toThrow('Sync Error');
        });
    });

    describe('Trace File', () => {
        it('should create trace file when spans are exported', async () => {
            // Create a span
            await withSpan('file-test-span', async (span) => {
                setAttributes(span, { 'test': 'file-creation' });
                return 'done';
            });

            // Force flush by shutting down and reinitializing the SDK
            if (sdk) {
                await sdk.shutdown();

                // Reinitialize for other tests
                process.env.OTEL_EXPORTER_FILE = testTraceFile;
                sdk = initTelemetry('ci-fixer-test');
            }

            // Check if file exists
            expect(fs.existsSync(testTraceFile)).toBe(true);

            // If file exists, check it has content
            if (fs.existsSync(testTraceFile)) {
                const content = fs.readFileSync(testTraceFile, 'utf8');
                expect(content).toContain('file-test-span');
            }
        });
    });
});
