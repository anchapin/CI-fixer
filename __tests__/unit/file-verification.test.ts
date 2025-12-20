import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileVerificationService } from '../../services/sandbox/FileVerificationService';
import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';

describe('FileVerificationService', () => {
    let service: FileVerificationService;
    let sandbox: SandboxEnvironment;
    let config: AppConfig;

    beforeEach(() => {
        service = new FileVerificationService();
        sandbox = {
            runCommand: vi.fn(),
            readFile: vi.fn(),
        } as unknown as SandboxEnvironment;
        config = {} as unknown as AppConfig;
    });

    it('should verify requirements file content', async () => {
        vi.mocked(sandbox.readFile).mockResolvedValue('requests==2.25.1\npydantic>=2.0.0\n');
        
        const result = await service.verifyContentMatch(config, 'requirements.txt', './src/reqs.txt', sandbox);
        expect(result).toBe(true);
    });

    it('should fail if requirements file content is invalid', async () => {
        vi.mocked(sandbox.readFile).mockResolvedValue('this is just a text file\nno dependencies here\n');
        
        const result = await service.verifyContentMatch(config, 'requirements.txt', './src/not-reqs.txt', sandbox);
        expect(result).toBe(false);
    });

    it('should validate candidate via dry-run build', async () => {
        vi.mocked(sandbox.runCommand).mockResolvedValueOnce({
            stdout: 'Build success',
            stderr: '',
            exitCode: 0
        });

        const result = await service.dryRunBuild(config, 'docker build .', sandbox);
        expect(result).toBe(true);
    });

    it('should fail validation if dry-run build fails', async () => {
        vi.mocked(sandbox.runCommand).mockResolvedValueOnce({
            stdout: '',
            stderr: 'Error: file not found',
            exitCode: 1
        });

        const result = await service.dryRunBuild(config, 'docker build .', sandbox);
        expect(result).toBe(false);
    });
});
