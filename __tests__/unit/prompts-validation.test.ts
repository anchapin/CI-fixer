import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Prompt Validation', () => {
    it('code-fix-v1.md should explicitly forbid conversational filler', () => {
        const promptPath = join(process.cwd(), 'prompts/execution/code-fix-v1.md');
        const content = readFileSync(promptPath, 'utf-8');
        
        // This is what we want to add
        expect(content).toMatch(/forbid|conversational|filler|safety|backticks/i);
        expect(content).toContain('conversational filler');
    });
});
