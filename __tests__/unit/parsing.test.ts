import { describe, it, expect } from 'vitest';
import { extractCodeBlock, hasCodeBlock } from '../../utils/parsing';

describe('extractCodeBlock', () => {
    it('extracts content from a simple code block', () => {
        const input = '```\nconsole.log("hello");\n```';
        expect(extractCodeBlock(input)).toBe('console.log("hello");');
    });

    it('extracts content from a code block with language identifier', () => {
        const input = '```typescript\nconst x = 1;\n```';
        expect(extractCodeBlock(input)).toBe('const x = 1;');
    });

    it('extracts content when surrounded by conversational text', () => {
        const input = 'Here is the code:\n' +
            '```\n' +
            'print("hello")\n' +
            '```\n' +
            'I hope this helps!';
        expect(extractCodeBlock(input)).toBe('print("hello")');
    });

    it('extracts content from a single-line code block', () => {
        const input = 'Check this out: ```print("hello")```';
        expect(extractCodeBlock(input)).toBe('print("hello")');
    });

    it('extracts the first code block if multiple are present', () => {
        const input = '```block1``` and then ```block2```';
        expect(extractCodeBlock(input)).toBe('block1');
    });

    it('handles code blocks with spaces in the opening tag', () => {
        const input = '``` python\nprint(1)\n```';
        expect(extractCodeBlock(input)).toBe('print(1)');
    });

    it('returns null if no code block is found', () => {
        const input = 'Just some text without code blocks.';
        expect(extractCodeBlock(input)).toBeNull();
    });

    it('handles incomplete code blocks (missing closing backticks)', () => {
        const input = '```\nconsole.log("oops")';
        expect(extractCodeBlock(input)).toBeNull();
    });

    it('trims whitespace from extracted content', () => {
        const input = '```\n  code  \n```';
        expect(extractCodeBlock(input)).toBe('code');
    });
});

describe('hasCodeBlock', () => {
    it('returns true if text contains a code block', () => {
        expect(hasCodeBlock('```code```')).toBe(true);
    });

    it('returns false if text does not contain a code block', () => {
        expect(hasCodeBlock('just text')).toBe(false);
    });
});
