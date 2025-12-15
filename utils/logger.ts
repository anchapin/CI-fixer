/**
 * Simple logger utility for graph nodes
 */

export function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS' | 'VERBOSE', message: string): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;

    switch (level) {
        case 'ERROR':
            console.error(`${prefix} ${message}`);
            break;
        case 'WARN':
            console.warn(`${prefix} ${message}`);
            break;
        case 'DEBUG':
        case 'VERBOSE':
            if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'verbose') {
                console.log(`${prefix} ${message}`);
            }
            break;
        default:
            console.log(`${prefix} ${message}`);
    }
}
