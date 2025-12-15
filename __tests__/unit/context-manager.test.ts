
import { describe, it, expect } from 'vitest';
import { thinLog, formatHistorySummary, IterationSummary, ContextManager, ContextPriority, formatPlanToMarkdown, compressFeedbackHistory } from '../../services/context-manager';

describe('Context Manager', () => {
    it('should result in identical text if lines are fewer than max', () => {
        const text = "line1\nline2\nline3";
        expect(thinLog(text, 10)).toBe(text);
    });

    it('should truncate text if lines exceed max', () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
        const text = lines.join('\n');
        const thinned = thinLog(text, 10);

        expect(thinned).toContain('line 0');
        expect(thinned).toContain('line 19');
        expect(thinned).toContain('Context Thinned');
        expect(thinned.split('\n').length).toBeLessThan(20);
    });

    it('should format history summary correctly', () => {
        const summaries: IterationSummary[] = [{
            iteration: 0,
            diagnosis: "Diagnosis summary",
            action: "edit",
            targetParams: "file.ts",
            result: "failure",
            outcomeSummary: "Failed to compile"
        }];

        const formatted = formatHistorySummary(summaries);
        expect(formatted).toContain("Previous Attempts History");
        expect(formatted).toContain("[Iter 0] ❌ Action: edit on `file.ts`");
        expect(formatted).toContain("Outcome: Failed to compile");
    });

    describe('ContextManager Class', () => {
        it('should include all items if within budget', () => {
            const cm = new ContextManager(1000);
            cm.addItem({ id: '1', type: 'text', priority: ContextPriority.CRITICAL, content: 'Short critical content' });
            cm.addItem({ id: '2', type: 'text', priority: ContextPriority.LOW, content: 'Short low priority content' });

            const result = cm.compile();
            expect(result).toContain('Short critical content');
            expect(result).toContain('Short low priority content');
        });

        it('should drop/truncate low priority items when budget is exceeded', () => {
            // Very strict budget: 10 tokens (~35 chars). 
            // Headers take space! "=== 1 ===\n" is ~10 chars
            const cm = new ContextManager(10);

            cm.addItem({ id: 'high', type: 'text', priority: ContextPriority.HIGH, content: 'High' });
            cm.addItem({ id: 'low', type: 'text', priority: ContextPriority.LOW, content: 'Low' });

            const result = cm.compile();

            // High priority is added first. "=== high ===\nHigh" -> ~15 chars. (4 tokens)
            // Remaining budget: 6 tokens.
            // Low priority: "--- low ---\nLow" -> ~15 chars. (4 tokens).
            // It might fit both if estimating 4 chars = 1 token.
            // Let's try larger content.

            const cm2 = new ContextManager(20); // 70 chars
            const bigContent = "A".repeat(100); // 100 chars -> 28 tokens alone.

            cm2.addItem({ id: 'critical', type: 'text', priority: ContextPriority.CRITICAL, content: 'Must have' });
            cm2.addItem({ id: 'low', type: 'text', priority: ContextPriority.LOW, content: bigContent });

            const res2 = cm2.compile();
            expect(res2).toContain('Must have');
            // High priority is kept. Low priority dropped due to tiny budget.
            expect(res2).not.toContain('AAAAA');
        });

        it('should preserve critical logs even if thinned', () => {
            const cm = new ContextManager(50); // ~175 chars
            const longLog = Array.from({ length: 50 }, (_, i) => `Log line ${i}`).join('\n'); // 50*10 = 500 chars

            cm.addItem({ id: 'logs', type: 'log', priority: ContextPriority.CRITICAL, content: longLog });

            const res = cm.compile();
            // Should contain head and tail
            expect(res).toContain('Log line 0');
            expect(res).toContain('Log line 49');
            expect(res).toContain('Context Thinned'); // Matching the actual output string from thinLog
        });
    });

    describe('clear', () => {
        it('should remove all items', () => {
            const manager = new ContextManager();

            manager.addItem({
                id: 'item1',
                type: 'text',
                content: 'Test content',
                priority: ContextPriority.HIGH
            });

            manager.addItem({
                id: 'item2',
                type: 'text',
                content: 'More content',
                priority: ContextPriority.MEDIUM
            });

            manager.clear();

            const compiled = manager.compile();
            expect(compiled).toBe('');
        });
    });

    describe('compile with truncation', () => {
        it('should truncate text items when budget exceeded', () => {
            const manager = new ContextManager(100); // Very small budget

            const longText = 'A'.repeat(1000);
            manager.addItem({
                id: 'long-text',
                type: 'text',
                content: longText,
                priority: ContextPriority.MEDIUM
            });

            const compiled = manager.compile();

            expect(compiled).toContain('[Truncated due to context limit]');
            expect(compiled.length).toBeLessThan(longText.length);
        });

        it('should truncate code items when budget exceeded', () => {
            const manager = new ContextManager(100);

            const longCode = 'function test() {\n' + '  console.log("test");\n'.repeat(100) + '}';
            manager.addItem({
                id: 'long-code',
                type: 'code',
                content: longCode,
                priority: ContextPriority.MEDIUM
            });

            const compiled = manager.compile();

            expect(compiled).toContain('[Truncated due to context limit]');
        });

        it('should aggressively thin critical items when budget very low', () => {
            const manager = new ContextManager(50); // Extremely small budget

            const criticalLog = 'Line 1\n'.repeat(100);
            manager.addItem({
                id: 'critical-log',
                type: 'log',
                content: criticalLog,
                priority: ContextPriority.CRITICAL
            });

            const compiled = manager.compile();

            // Should still include something from critical item
            expect(compiled).toContain('critical-log');
            expect(compiled).toContain('[Context Thinned');
        });

        it('should drop non-critical items when budget too small', () => {
            const manager = new ContextManager(50);

            manager.addItem({
                id: 'critical',
                type: 'text',
                content: 'Critical info',
                priority: ContextPriority.CRITICAL
            });

            manager.addItem({
                id: 'low-priority',
                type: 'text',
                content: 'A'.repeat(500),
                priority: ContextPriority.LOW
            });

            const compiled = manager.compile();

            expect(compiled).toContain('Critical info');
            expect(compiled).not.toContain('low-priority');
        });
    });
});

describe('formatPlanToMarkdown', () => {
    it('should format plan with tasks', () => {
        const plan = {
            goal: 'Fix the bug',
            tasks: [
                { description: 'Task 1', status: 'done' },
                { description: 'Task 2', status: 'pending' }
            ],
            approved: true
        };

        const markdown = formatPlanToMarkdown(plan);

        expect(markdown).toContain('# Implementation Plan');
        expect(markdown).toContain('**Goal**: Fix the bug');
        expect(markdown).toContain('- [x] Task 1');
        expect(markdown).toContain('- [ ] Task 2');
        expect(markdown).toContain('**Approved**: true');
    });

    it('should handle empty tasks array', () => {
        const plan = {
            goal: 'Test goal',
            tasks: [],
            approved: false
        };

        const markdown = formatPlanToMarkdown(plan);

        expect(markdown).toContain('# Implementation Plan');
        expect(markdown).toContain('**Goal**: Test goal');
        expect(markdown).toContain('**Approved**: false');
    });

    it('should handle missing tasks property', () => {
        const plan = {
            goal: 'Test goal',
            approved: true
        };

        const markdown = formatPlanToMarkdown(plan);

        expect(markdown).toContain('# Implementation Plan');
    });
});

describe('compressFeedbackHistory', () => {
    it('should truncate long items', () => {
        const history = [
            'Short item',
            'A'.repeat(500)
        ];

        const compressed = compressFeedbackHistory(history);

        expect(compressed).toContain('[Item 1] Short item');
        expect(compressed).toContain('[Item 2]');
        expect(compressed).toContain('(truncated)');
    });

    it('should keep short items intact', () => {
        const history = [
            'Item 1',
            'Item 2',
            'Item 3'
        ];

        const compressed = compressFeedbackHistory(history);

        expect(compressed).toContain('[Item 1] Item 1');
        expect(compressed).toContain('[Item 2] Item 2');
        expect(compressed).toContain('[Item 3] Item 3');
    });
});
