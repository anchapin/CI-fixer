/**
 * Simple trace viewer for CI-Fixer traces
 * Reads and displays traces from the JSON file
 */

import * as fs from 'fs';
import * as path from 'path';

interface Trace {
    timestamp: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    duration: number;
    attributes: Record<string, any>;
    status: any;
    events: any[];
}

function loadTraces(filePath: string): Trace[] {
    if (!fs.existsSync(filePath)) {
        console.error(`Trace file not found: ${filePath}`);
        return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.flatMap(line => {
        try {
            return JSON.parse(line);
        } catch {
            return [];
        }
    });
}

function buildTraceTree(traces: Trace[]): Map<string, Trace[]> {
    const traceMap = new Map<string, Trace[]>();

    traces.forEach(trace => {
        if (!traceMap.has(trace.traceId)) {
            traceMap.set(trace.traceId, []);
        }
        traceMap.get(trace.traceId)!.push(trace);
    });

    return traceMap;
}

function printTrace(traces: Trace[], indent: number = 0) {
    const rootSpans = traces.filter(t => !t.parentSpanId);

    rootSpans.forEach(root => {
        const prefix = '  '.repeat(indent);
        const duration = (root.duration / 1_000_000).toFixed(2);
        const status = root.status.code === 0 ? '✓' : '✗';

        console.log(`${prefix}${status} ${root.name} (${duration}ms)`);

        // Print key attributes
        if (root.attributes) {
            const importantAttrs = ['llm.provider', 'llm.model', 'llm.tokens_estimated', 'node.name', 'error.category'];
            Object.entries(root.attributes).forEach(([key, value]) => {
                if (importantAttrs.includes(key)) {
                    console.log(`${prefix}  ${key}: ${value}`);
                }
            });
        }

        // Print events
        if (root.events && root.events.length > 0) {
            console.log(`${prefix}  Events:`);
            root.events.forEach(event => {
                console.log(`${prefix}    - ${event.name}`);
            });
        }

        // Print children
        const children = traces.filter(t => t.parentSpanId === root.spanId);
        if (children.length > 0) {
            printTrace(children, indent + 1);
        }
    });
}

// Main
const traceFile = process.argv[2] || './logs/traces.json';

if (!fs.existsSync(traceFile)) {
    console.error(`\nTrace file not found: ${traceFile}`);
    console.log('\nUsage: npm run view-traces [trace-file]');
    console.log('Default: ./logs/traces.json\n');
    console.log('To enable tracing, set environment variable:');
    console.log('  OTEL_EXPORTER_FILE=./logs/traces.json\n');
    process.exit(1);
}

const traces = loadTraces(traceFile);
const traceMap = buildTraceTree(traces);

console.log(`\n=== CI-Fixer Traces (${traceMap.size} traces) ===\n`);

traceMap.forEach((spans, traceId) => {
    console.log(`\nTrace ID: ${traceId.substring(0, 16)}...`);
    console.log('─'.repeat(80));
    printTrace(spans);
    console.log('');
});

console.log(`Total spans: ${traces.length}\n`);
