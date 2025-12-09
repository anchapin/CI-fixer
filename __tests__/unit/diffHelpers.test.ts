
import { describe, it, expect } from 'vitest';
import { getStats, getContextualDiff } from '../../utils/diffHelpers';

describe('Diff Helpers', () => {
    it('should calculate added and removed lines correctly', () => {
        const original = "line1\nline2";
        const modified = "line1\nline2\nline3"; // 1 line added
        const stats = getStats(original, modified);
        expect(stats.added).toBe(1);
        expect(stats.removed).toBe(0);
    });

    it('should detect removals', () => {
        const original = "line1\nline2";
        const modified = "line1"; // 1 line removed
        const stats = getStats(original, modified);
        expect(stats.added).toBe(0);
        expect(stats.removed).toBe(1);
    });

    it('should hide unchanged context correctly', () => {
        const original = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
        // Modify only the last line (line19)
        const modified = original.replace('line19', 'line19-mod'); 

        // With context=3, we expect to see the start (maybe) or just the end context
        // Since the change is at the end, we should see a spacer in the middle.
        const { diffRender } = getContextualDiff(original, modified, 3);
        
        // We expect a spacer because there are > 6 unchanged lines
        const spacer = diffRender.find(p => p.isSpacer);
        expect(spacer).toBeDefined();
        expect(spacer?.value).toContain('unchanged lines hidden');
    });

    it('should show all lines if context constraint is not met', () => {
        const original = "line1\nline2\nline3";
        const modified = "line1\nline2-mod\nline3";
        
        const { diffRender } = getContextualDiff(original, modified, 3);
        const spacer = diffRender.find(p => p.isSpacer);
        expect(spacer).toBeUndefined();
    });
});
