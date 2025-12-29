
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSandboxTest } from '../../services/analysis/LogAnalysisService.js';

// We don't mock TestSelector anymore to verify real integration
// vi.mock('../../services/TestSelector.js', ...);

describe('LogAnalysisService - Test Selection', () => {
    let mockSandbox: any;
    const mockLogCallback = vi.fn();

    beforeEach(() => {
        mockSandbox = {
            writeFile: vi.fn().mockResolvedValue(undefined),
            runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'PASS', stderr: '' }),
            getId: () => 'mock-sandbox'
        };
        vi.clearAllMocks();
    });

    it('should use TestSelector to determine the test command', async () => {
        const fileChange = {
            path: 'backend/test.py',
            modified: { content: 'print("hello")' }
        };

        await runSandboxTest(
            { checkEnv: 'e2b' } as any,
            {} as any,
            1,
            false,
            fileChange as any,
            'fix error',
            mockLogCallback,
            {},
            mockSandbox
        );

        // Verify that TestSelector logic was used (backend/test.py -> pytest)
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringContaining('python -m pytest'));
    });
});
