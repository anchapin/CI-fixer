import { describe, it, expect } from 'vitest';

// Simulating the current vulnerable implementation of writeFile
async function vulnerableWriteFile(filePath: string, content: string): Promise<string> {
    // In the real implementation, this writes to fs
    // Here we just return what would be written to verify the bug
    return content;
}

describe('Chatty Output Injection Reproduction', () => {
    it('reproduces the issue where conversational filler is written to the file', async () => {
        const chattyContent = `python-dotenv==1.2.1Of course. Based on the provided requirements.txt...`;
        
        // Act
        const result = await vulnerableWriteFile('requirements.txt', chattyContent);

        // Assert
        // The bug is that the file content INCLUDES the chatty text
        expect(result).toContain('python-dotenv==1.2.1Of course');
        expect(result).not.toBe('python-dotenv==1.2.1');
    });

    it('reproduces the issue with markdown code blocks mixed with chat', async () => {
        const mixedContent = `Here is the code:
\
\
print("hello")
\
\
I hope this helps!`;
        
        // Act
        const result = await vulnerableWriteFile('script.py', mixedContent);

        // Assert
        expect(result).toContain('Here is the code:');
        expect(result).toContain('I hope this helps!');
        expect(result).not.toBe('print("hello")');
    });
});
