import { describe, it, expect } from 'vitest';
import { BunErrorPattern } from '../../../../services/analysis/BunErrorPattern';

describe('BunErrorPattern', () => {
    describe('isBunError', () => {
        it('should detect "Cannot bundle built-in module bun:test"', () => {
            const errorLog = `
                Error: Cannot bundle built-in module "bun:test"
                at bundle (/node_modules/vite/dist/node/chunks/dep-123.js:45:67)
            `;
            const result = BunErrorPattern.diagnose(errorLog);
            expect(result.isBunError).toBe(true);
            expect(result.description).toContain('Bun-specific module "bun:test" detected in non-Bun environment');
        });

        it('should detect "bun: command not found"', () => {
             const errorLog = `
                /bin/sh: 1: bun: not found
                npm ERR! code 127
            `;
            const result = BunErrorPattern.diagnose(errorLog);
            expect(result.isBunError).toBe(true);
            expect(result.description).toContain('Bun CLI not found');
        });

        it('should detect "Bun is not defined" (runtime error)', () => {
             const errorLog = `
                ReferenceError: Bun is not defined
                at /src/index.ts:10:5
            `;
            const result = BunErrorPattern.diagnose(errorLog);
            expect(result.isBunError).toBe(true);
            expect(result.description).toContain('Global "Bun" object accessed in non-Bun environment');
        });

        it('should return false for generic errors', () => {
            const errorLog = `
                Error: Cannot find module './utils'
                at /src/index.ts:5:5
            `;
            const result = BunErrorPattern.diagnose(errorLog);
            expect(result.isBunError).toBe(false);
            expect(result.description).toBeUndefined();
        });
    });
});
