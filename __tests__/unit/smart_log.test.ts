
import { describe, it, expect } from 'vitest';
import { smartThinLog } from '../../services/context-manager.js';

describe('Context Manager: Smart Log Retrieval', () => {

    it('should return full content if short', async () => {
        const shortLog = "Line 1\nLine 2\nLine 3";
        const result = await smartThinLog(shortLog, 10);
        expect(result).toBe(shortLog);
    });

    it('should fallback to head/tail if no errors found', async () => {
        const longLog = Array.from({ length: 100 }, (_, i) => `Log line ${i}`).join('\n');
        const result = await smartThinLog(longLog, 20); // Keep 10 top, 10 bottom

        expect(result).toContain("Log line 0");
        expect(result).toContain("Log line 99");
        expect(result).not.toContain("Log line 50");
        expect(result).toContain("Context Thinned");
    });

    it('should extract context around "Error"', async () => {
        const lines = Array.from({ length: 100 }, (_, i) => `Log line ${i}`);
        lines[50] = "Running tests...";
        lines[51] = "ERROR: NullPointerException at specific line";
        lines[52] = "Stack trace line 1";

        const longLog = lines.join('\n');
        const result = await smartThinLog(longLog, 50);

        expect(result).toContain("ERROR: NullPointerException");
        expect(result).toContain("Log line 45"); // Context before
        expect(result).toContain("Log line 55"); // Context after
        expect(result).toContain("Smart Context: Skipped");
    });

    it('should merge overlapping error windows', async () => {
        const lines = Array.from({ length: 100 }, (_, i) => `Log line ${i}`);
        lines[40] = "Error one";
        lines[42] = "Error two (close to one)";

        const longLog = lines.join('\n');
        const result = await smartThinLog(longLog, 50);

        expect(result).toContain("Error one");
        expect(result).toContain("Error two");
        expect(result).toContain("Log line 35"); // Pre-context
        expect(result).toContain("Log line 47"); // Post-context
        // Should not have a skip marker between 40 and 42
        const check = result.substring(result.indexOf("Error one"), result.indexOf("Error two"));
        expect(check).not.toContain("Skipped");
    });
});
