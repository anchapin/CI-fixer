
import { describe, it, expect, vi } from 'vitest';
import { toolCodeSearch } from '../../services';

describe('Enhanced Code Search', () => {
    const mockConfig: any = {};
    const mockSandbox: any = {
        runCommand: vi.fn()
    };

    it('should use basic grep for reference search', async () => {
        mockSandbox.runCommand.mockResolvedValue({ exitCode: 0, stdout: "file.ts:1", stderr: "" });
        await toolCodeSearch(mockConfig, "myVar", mockSandbox, 'ref');

        expect(mockSandbox.runCommand).toHaveBeenCalledWith(
            expect.stringContaining('grep -r "myVar" .')
        );
        expect(mockSandbox.runCommand).not.toHaveBeenCalledWith(
            expect.stringContaining('-E')
        );
    });

    it('should use extended grep for definition search', async () => {
        mockSandbox.runCommand.mockResolvedValue({ exitCode: 0, stdout: "file.ts:class MyClass", stderr: "" });
        await toolCodeSearch(mockConfig, "MyClass", mockSandbox, 'def');

        expect(mockSandbox.runCommand).toHaveBeenCalledWith(
            expect.stringContaining('grep -rE')
        );
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(
            expect.stringContaining('MyClass\\b')
        );
    });
});
