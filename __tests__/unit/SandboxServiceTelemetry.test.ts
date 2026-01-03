import { describe, it, expect, vi } from 'vitest';
import { toolRunCodeMode } from '../../services/sandbox/SandboxService';
import { collectPathCorrections } from '../../services/telemetry/PathCorrectionCollector';
import { AppConfig } from '../../types';

vi.mock('../../services/telemetry/PathCorrectionCollector', () => ({
    collectPathCorrections: vi.fn().mockResolvedValue(1)
}));

describe('SandboxService Telemetry', () => {
    it('should NOT call collectPathCorrections (disabled for frontend compatibility)', async () => {
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

        // collectPathCorrections is disabled for frontend compatibility
        expect(collectPathCorrections).not.toHaveBeenCalled();
    });
});
