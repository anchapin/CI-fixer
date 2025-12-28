import { describe, it, expect, vi } from 'vitest';
import { toolRunCodeMode } from '../../services/sandbox/SandboxService';
import { AppConfig } from '../../types';
import { LoopDetector } from '../../services/LoopDetector';

describe('SandboxService Loop Detector Wiring', () => {
    const mockConfig: AppConfig = {
        model: 'test-model',
    } as any;

    it('should inject advice into output when loop is detected', async () => {
        // Mock Sandbox
        const mockSandbox: any = {
            writeFile: vi.fn(),
            runCommand: vi.fn().mockResolvedValue({
                stdout: 'Error: File not found\n[PATH_NOT_FOUND] {"tool":"read","path":"bad.ts","timestamp":"2024-01-01T00:00:00Z"}',
                stderr: '',
                exitCode: 1
            })
        };

        // Mock LoopDetector
        const mockLoopDetector = {
            recordHallucination: vi.fn(),
            shouldTriggerStrategyShift: vi.fn().mockReturnValue(true),
            triggerAutomatedRecovery: vi.fn().mockReturnValue('glob("**/*.ts")'),
            getLastHallucinatedPath: vi.fn(),
            addState: vi.fn(),
            detectLoop: vi.fn(),
            getHallucinationCount: vi.fn(),
            getTotalHallucinations: vi.fn(),
        } as unknown as LoopDetector;

        const output = await toolRunCodeMode(mockConfig, 'console.log("test")', mockSandbox, mockLoopDetector);

        expect(mockLoopDetector.recordHallucination).toHaveBeenCalledWith('bad.ts');
        expect(output).toContain('[SYSTEM ADVICE]: glob("**/*.ts")');
    });
});
