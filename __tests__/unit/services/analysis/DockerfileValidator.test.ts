
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerfileValidator } from '../../../../services/analysis/DockerfileValidator.js';

describe('DockerfileValidator', () => {
    const mockConfig = {} as any;
    const mockSandbox = {
        runCommand: vi.fn()
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return valid if no issues found', async () => {
        mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' }); // hadolint
        mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: 'Successfully built', stderr: '' }); // build

        const result = await DockerfileValidator.validate(mockConfig, 'Dockerfile', mockSandbox);

        expect(result.valid).toBe(true);
        expect(result.issues).toHaveLength(0);
    });

    it('should parse hadolint errors correctly', async () => {
        const hadolintOutput = JSON.stringify([
            { line: 5, column: 1, code: 'DL3008', message: 'Pin versions in apt get install', level: 'warning' },
            { line: 10, column: 1, code: 'DL3001', message: 'For explicit error', level: 'error' }
        ]);

        mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 1, stdout: hadolintOutput, stderr: '' });
        mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: 'Built', stderr: '' });

        const result = await DockerfileValidator.validate(mockConfig, 'Dockerfile', mockSandbox);

        expect(result.valid).toBe(false);
        expect(result.issues).toHaveLength(2);
        expect(result.issues[1].level).toBe('error');
        expect(result.issues[0].code).toBe('DL3008');
    });

    it('should handle docker build failures', async () => {
        mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: '[]', stderr: '' }); // hadolint
        mockSandbox.runCommand.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Unknown instruction: FOO' }); // build

        const result = await DockerfileValidator.validate(mockConfig, 'Dockerfile', mockSandbox);

        expect(result.valid).toBe(false);
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'BUILD_ERROR',
            level: 'error'
        }));
    });
});
