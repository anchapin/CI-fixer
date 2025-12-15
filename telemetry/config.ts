/**
 * Simplified OpenTelemetry configuration for CI-Fixer
 * Provides distributed tracing and metrics collection
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import * as fs from 'fs';
import * as path from 'path';

/**
 * File-based span exporter for persistent traces
 * Writes traces to a JSON file for later analysis
 */
export class FileSpanExporter extends ConsoleSpanExporter {
    private logFile: string;

    constructor(logFile: string) {
        super();
        this.logFile = logFile;

        // Ensure directory exists
        const dir = path.dirname(logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    export(spans: any[], resultCallback: (result: any) => void): void {
        const timestamp = new Date().toISOString();
        const data = spans.map(span => ({
            timestamp,
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            kind: span.kind,
            startTime: span.startTime,
            endTime: span.endTime,
            duration: span.endTime[0] - span.startTime[0],
            attributes: span.attributes,
            status: span.status,
            events: span.events
        }));

        try {
            fs.appendFileSync(this.logFile, JSON.stringify(data, null, 2) + '\n');
            resultCallback({ code: 0 });
        } catch (error) {
            console.error('[Telemetry] Failed to write traces:', error);
            resultCallback({ code: 1 });
        }
    }
}

/**
 * Initialize OpenTelemetry SDK
 * Call this at application startup
 */
export function initTelemetry(serviceName: string = 'ci-fixer-agent'): NodeSDK | null {
    // Determine exporter based on environment
    const exporterFile = process.env.OTEL_EXPORTER_FILE;
    const useConsole = process.env.OTEL_EXPORTER_CONSOLE === 'true';

    if (!exporterFile && !useConsole) {
        console.log('[Telemetry] Disabled (no exporter configured)');
        return null;
    }

    let exporter;
    if (exporterFile) {
        console.log(`[Telemetry] Writing traces to: ${exporterFile}`);
        exporter = new FileSpanExporter(exporterFile);
    } else {
        console.log('[Telemetry] Using console exporter');
        exporter = new ConsoleSpanExporter();
    }

    const sdk = new NodeSDK({
        serviceName,
        spanProcessor: new BatchSpanProcessor(exporter),
        instrumentations: [
            getNodeAutoInstrumentations({
                // Disable file system instrumentation (too noisy)
                '@opentelemetry/instrumentation-fs': { enabled: false },
            }),
        ],
    });

    sdk.start();
    console.log('[Telemetry] OpenTelemetry SDK initialized');

    // Graceful shutdown
    process.on('SIGTERM', () => {
        sdk.shutdown()
            .then(() => console.log('[Telemetry] SDK terminated'))
            .catch((error) => console.log('[Telemetry] Error terminating SDK', error))
            .finally(() => process.exit(0));
    });

    return sdk;
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
    return !!(process.env.OTEL_EXPORTER_FILE || process.env.OTEL_EXPORTER_CONSOLE);
}
