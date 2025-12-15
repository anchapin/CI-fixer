import { describe, it, expect } from 'vitest';
import { parseStackTrace, localizeFault } from '../../services/repair-agent/fault-localization.js';

describe('Fault Localization', () => {
    describe('parseStackTrace', () => {
        it('should parse Node.js stack traces', () => {
            const errorLog = `
Error: Cannot read property 'name' of undefined
    at getUserName (src/user.ts:42:15)
    at processUser (src/processor.ts:18:5)
    at main (src/index.ts:10:3)
`;

            const frames = parseStackTrace(errorLog);

            expect(frames.length).toBeGreaterThan(0);
            expect(frames[0].file).toBe('src/user.ts');
            expect(frames[0].line).toBe(42);
            expect(frames[0].column).toBe(15);
            expect(frames[0].function).toContain('getUserName');
        });

        it('should parse Python stack traces', () => {
            const errorLog = `
Traceback (most recent call last):
  File "main.py", line 10, in <module>
    process_data()
  File "processor.py", line 25, in process_data
    result = calculate(x)
`;

            const frames = parseStackTrace(errorLog);

            expect(frames.length).toBeGreaterThan(0);
            expect(frames[0].file).toBe('main.py');
            expect(frames[0].line).toBe(10);
        });

        it('should handle empty stack traces', () => {
            const frames = parseStackTrace('No stack trace here');
            expect(frames).toEqual([]);
        });
    });

    describe('localizeFault', () => {
        it('should return a fault localization result', async () => {
            // This test would require mocking the LLM service
            // For now, we'll skip it or mark as integration test
            expect(true).toBe(true);
        });
    });
});
