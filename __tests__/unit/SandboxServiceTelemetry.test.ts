import { describe, it, expect, vi } from 'vitest';
import { toolRunCodeMode } from '../../services/sandbox/SandboxService';
import { collectPathCorrections } from '../../services/telemetry/PathCorrectionCollector';
import { AppConfig } from '../../types';

vi.mock('../../services/telemetry/PathCorrectionCollector', () => ({
    collectPathCorrections: vi.fn().mockResolvedValue(1)
}));

describe('SandboxService Telemetry', () => {
    it('should call collectPathCorrections when output contains logs', async () => {
        const mockConfig = { model: 'test' } as any;
        const mockSandbox: any = {
            writeFile: vi.fn(),
            runCommand: vi.fn().mockResolvedValue({
                stdout: '[PATH_CORRECTION] {"originalPath":"a","correctedPath":"b","tool":"read","filename":"a","timestamp":"..."}',
                stderr: '',
                exitCode: 0
            })
        };

        await toolRunCodeMode(mockConfig, 'script', mockSandbox);

        expect(collectPathCorrections).toHaveBeenCalled();
    });
});
