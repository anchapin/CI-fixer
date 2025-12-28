import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileVerificationService } from '../../services/sandbox/FileVerificationService';
import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';

describe('FileVerificationService Enhanced', () => {
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

    describe('verifyContentMatch', () => {
        it('should return false if requirements file is empty after filtering', async () => {
            vi.mocked(sandbox.readFile).mockResolvedValue('# only comments\n\n  \n');
            const result = await service.verifyContentMatch(config, 'requirements.txt', 'reqs.txt', sandbox);
            expect(result).toBe(false);
        });

        it('should return false if package.json is invalid JSON', async () => {
            vi.mocked(sandbox.readFile).mockResolvedValue('{ invalid json');
            const result = await service.verifyContentMatch(config, 'package.json', 'package.json', sandbox);
            expect(result).toBe(false);
        });

        it('should return false if package.json does not have expected properties', async () => {
            vi.mocked(sandbox.readFile).mockResolvedValue('{"something": "else"}');
            const result = await service.verifyContentMatch(config, 'package.json', 'package.json', sandbox);
            expect(result).toBe(false);
        });

        it('should return true for generic file that is not empty', async () => {
            vi.mocked(sandbox.readFile).mockResolvedValue('some random content');
            const result = await service.verifyContentMatch(config, 'other.txt', 'other.txt', sandbox);
            expect(result).toBe(true);
        });

        it('should return false for generic file that is empty', async () => {
            vi.mocked(sandbox.readFile).mockResolvedValue('   ');
            const result = await service.verifyContentMatch(config, 'other.txt', 'other.txt', sandbox);
            expect(result).toBe(false);
        });

        it('should return false on readFile exception', async () => {
            vi.mocked(sandbox.readFile).mockRejectedValue(new Error('read error'));
            const result = await service.verifyContentMatch(config, 'other.txt', 'other.txt', sandbox);
            expect(result).toBe(false);
        });
    });

    describe('dryRunBuild', () => {
        it('should return false on runCommand exception', async () => {
            vi.mocked(sandbox.runCommand).mockRejectedValue(new Error('exec error'));
            const result = await service.dryRunBuild(config, 'make', sandbox);
            expect(result).toBe(false);
        });
    });
});
