
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as config from '../../../telemetry/config.js';
import * as fs from 'fs';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

// Mock dependencies
vi.mock('@opentelemetry/sdk-node', () => {
    return {
        NodeSDK: class {
            constructor() { }
            start() { }
            shutdown() { return Promise.resolve(); }
        }
    };
});

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
    getNodeAutoInstrumentations: vi.fn()
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
    ConsoleSpanExporter: vi.fn(),
    BatchSpanProcessor: vi.fn()
}));

vi.mock('fs', async () => {
    return {
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        appendFileSync: vi.fn(),
    };
});

describe('Telemetry Config', () => {
    const originalEnv = process.env;
    let consoleLogSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
    });

    describe('initTelemetry', () => {
        it('should return null if telemetry disabled (no env vars)', () => {
            delete process.env.OTEL_EXPORTER_FILE;
            delete process.env.OTEL_EXPORTER_CONSOLE;

            const sdk = config.initTelemetry();
            expect(sdk).toBeNull();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Disabled'));
        });

        it('should initialize with ConsoleSpanExporter if configured', () => {
            process.env.OTEL_EXPORTER_CONSOLE = 'true';

            const sdk = config.initTelemetry();
            expect(sdk).toBeTruthy();
            expect(ConsoleSpanExporter).toHaveBeenCalled();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Using console exporter'));
        });

        it('should initialize with FileSpanExporter if configured', () => {
            process.env.OTEL_EXPORTER_FILE = 'traces.json';
            (fs.existsSync as any).mockReturnValue(true);

            const sdk = config.initTelemetry();
            expect(sdk).toBeTruthy();
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Writing traces to'));
        });
    });

    describe('isTelemetryEnabled', () => {
        it('should return false by default', () => {
            delete process.env.OTEL_EXPORTER_FILE;
            delete process.env.OTEL_EXPORTER_CONSOLE;
            expect(config.isTelemetryEnabled()).toBe(false);
        });

        it('should return true if file exporter set', () => {
            process.env.OTEL_EXPORTER_FILE = 'file';
            expect(config.isTelemetryEnabled()).toBe(true);
        });

        it('should return true if console exporter set', () => {
            process.env.OTEL_EXPORTER_CONSOLE = 'true';
            expect(config.isTelemetryEnabled()).toBe(true);
        });
    });

    // To test FileSpanExporter, we might need to access the class directly, 
    // but it's not exported. However, we can test it indirectly if we could trigger an export...
    // But since `initTelemetry` creates a NodeSDK instance and doesn't expose the exporter directly,
    // testing the internal `FileSpanExporter` class logic (checking `mkdir`, `appendFileSync`) 
    // is tricky without exporting it or using `rewire` (not standard in TS/Vitest).
    // Given the constraints, we verified the configuration logic above.
    // If we want to reach 100% on that file, we should verify that `fs.mkdirSync` is called during initialization 
    // if the directory doesn't exist.

    it('should create directory for file exporter if missing', () => {
        process.env.OTEL_EXPORTER_FILE = 'logs/traces.json';
        (fs.existsSync as any).mockReturnValue(false);
        // dirname logic: 'logs'

        // This test assumes FileSpanExporter is instantiated inside initTelemetry
        config.initTelemetry();

        expect(fs.mkdirSync).toHaveBeenCalledWith('logs', { recursive: true });
    });

    describe('FileSpanExporter', () => {
        it('should handle write errors during export', () => {
            // Need to cast to any since we just exported it but test doesn't know yet?
            // Actually we import * as config.
            const ExporterClass = (config as any).FileSpanExporter;
            const exporter = new ExporterClass('test.json');

            const mockCallback = vi.fn();
            (fs.appendFileSync as any).mockImplementation(() => { throw new Error('Write failed'); });

            const spans = [{
                spanContext: () => ({ traceId: '1', spanId: '1' }),
                parentSpanId: '0',
                name: 'test',
                kind: 0,
                startTime: [0, 0],
                endTime: [0, 0],
                status: {},
                events: []
            }];

            exporter.export(spans, mockCallback);

            expect(mockCallback).toHaveBeenCalledWith({ code: 1 });
            expect(consoleLogSpy).not.toHaveBeenCalled(); // Actually it logs to console.error
        });
    });

    describe('Graceful Shutdown', () => {
        it('should handle SIGTERM', async () => {
            process.env.OTEL_EXPORTER_CONSOLE = 'true'; // Enable telemetry
            const processOnSpy = vi.spyOn(process, 'on');
            const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

            config.initTelemetry();

            // Find the SIGTERM handler
            const calls = processOnSpy.mock.calls;
            const sigtermCall = calls.find(call => call[0] === 'SIGTERM');
            expect(sigtermCall).toBeDefined();

            if (sigtermCall) {
                const handler = sigtermCall[1] as Function;
                handler();
                await new Promise(resolve => setTimeout(resolve, 10)); // Allow promise chain to complete

                expect(processExitSpy).toHaveBeenCalledWith(0);
            }
        });
    });
});
