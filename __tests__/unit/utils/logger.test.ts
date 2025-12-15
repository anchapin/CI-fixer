
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log } from '../../../utils/logger.js';

describe('Logger Utility', () => {
    let consoleLogSpy: any;
    let consoleWarnSpy: any;
    let consoleErrorSpy: any;
    const originalEnv = process.env;

    beforeEach(() => {
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        process.env = { ...originalEnv };
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.env = originalEnv;
        vi.useRealTimers();
    });

    it('should log INFO messages to console.log', () => {
        log('INFO', 'Test info message');
        expect(consoleLogSpy).toHaveBeenCalledWith('[2024-01-01T00:00:00.000Z] [INFO] Test info message');
    });

    it('should log WARN messages to console.warn', () => {
        log('WARN', 'Test warn message');
        expect(consoleWarnSpy).toHaveBeenCalledWith('[2024-01-01T00:00:00.000Z] [WARN] Test warn message');
    });

    it('should log ERROR messages to console.error', () => {
        log('ERROR', 'Test error message');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[2024-01-01T00:00:00.000Z] [ERROR] Test error message');
    });

    it('should log SUCCESS messages to console.log', () => {
        log('SUCCESS', 'Test success message');
        expect(consoleLogSpy).toHaveBeenCalledWith('[2024-01-01T00:00:00.000Z] [SUCCESS] Test success message');
    });

    it('should not log DEBUG messages by default', () => {
        log('DEBUG', 'Test debug message');
        expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log DEBUG messages when LOG_LEVEL is debug', () => {
        process.env.LOG_LEVEL = 'debug';
        log('DEBUG', 'Test debug message');
        expect(consoleLogSpy).toHaveBeenCalledWith('[2024-01-01T00:00:00.000Z] [DEBUG] Test debug message');
    });

    it('should not log VERBOSE messages by default', () => {
        log('VERBOSE', 'Test verbose message');
        expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log VERBOSE messages when LOG_LEVEL is verbose', () => {
        process.env.LOG_LEVEL = 'verbose';
        log('VERBOSE', 'Test verbose message');
        expect(consoleLogSpy).toHaveBeenCalledWith('[2024-01-01T00:00:00.000Z] [VERBOSE] Test verbose message');
    });

    it('should log VERBOSE messages when LOG_LEVEL is debug (assuming debug includes verbose is NOT implemented in code, strictly checks string)', () => {
        // Based on code: if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'verbose')
        process.env.LOG_LEVEL = 'debug';
        log('VERBOSE', 'Test verbose message');
        expect(consoleLogSpy).toHaveBeenCalled();
    });
});
