import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileDiscoveryService } from '../../services/sandbox/FileDiscoveryService';
import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';

describe('FileDiscoveryService', () => {
    let service: FileDiscoveryService;
    let sandbox: SandboxEnvironment;
    let config: AppConfig;

    beforeEach(() => {
        service = new FileDiscoveryService();
        sandbox = {
            runCommand: vi.fn(),
            // Other sandbox methods mocked as needed
        } as any;
        config = {} as any;
    });

    it('should find exact match if file exists', async () => {
        vi.mocked(sandbox.runCommand).mockResolvedValueOnce({
            stdout: './src/existing-file.txt\n',
            stderr: '',
            exitCode: 0
        });

        const result = await service.recursiveSearch(config, 'existing-file.txt', sandbox);
        expect(result).toBe('./src/existing-file.txt');
    });

                it('should find fuzzy match if exact match fails', async () => {

                    vi.mocked(sandbox.runCommand)

                        // Fuzzy search (listing all files) - This is the ONLY call made by fuzzySearch directly

                        .mockResolvedValueOnce({ 

                            stdout: './src/requirements.txt\n./src/other.ts\n', 

                            stderr: '', 

                            exitCode: 0 

                        });

            

                    // Search for typo

                    const result = await service.fuzzySearch(config, 'requirments.txt', sandbox);

                    expect(result).toBe('./src/requirements.txt');

                });    it('should detect rename via git history', async () => {
        vi.mocked(sandbox.runCommand).mockResolvedValueOnce({
            stdout: 'R100\told-name.txt\tnew-name.txt\n',
            stderr: '',
            exitCode: 0
        });

        const result = await service.checkGitHistoryForRename(config, 'old-name.txt', sandbox);
        expect(result).toBe('new-name.txt');
    });

    it('should detect deletion via git history', async () => {
        vi.mocked(sandbox.runCommand).mockResolvedValueOnce({
            stdout: 'D\tdeleted-file.txt\n',
            stderr: '',
            exitCode: 0
        });

        const result = await service.checkGitHistoryForDeletion(config, 'deleted-file.txt', sandbox);
        expect(result).toBe(true);
    });
});
