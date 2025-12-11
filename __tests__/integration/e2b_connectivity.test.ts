
import { describe, it, expect } from 'vitest';
import { Sandbox } from '@e2b/code-interpreter';

// This test is designed to be run manually with a key provided via env var
// E2B_API_KEY=... npm test e2b_connectivity
describe('E2B Connectivity Integration Test', () => {
    const apiKey = process.env.E2B_API_KEY;

    if (!apiKey) {
        it('skips connection test (no API key)', () => {
            console.warn("Skipping E2B test: No E2B_API_KEY provided in environment.");
        });
        return;
    }

    it('should successfully connect to E2B and execute code', async () => {
        console.log("Attempting E2B connection with provided key...");
        const sandbox = await Sandbox.create({ apiKey });

        try {
            const result = await sandbox.runCode('echo "Connection Verified"', { language: 'bash' });
            // stdout is string[], so we join it to check for substring
            expect(result.logs.stdout.join('')).toContain('Connection Verified');
            console.log("E2B Connection Verified Successfully.");
        } catch (e) {
            console.error("E2B Connection Failed:", e);
            throw e;
        } finally {
            await sandbox.kill();
        }
    }, 30000); // 30s timeout for network ops
});
