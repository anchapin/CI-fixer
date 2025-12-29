import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DependencySolverService } from '../../services/DependencySolverService';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';
import { FixPatternService } from '../../services/FixPatternService';
import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';

describe('DependencySolverService', () => {
    let mockSandbox: SandboxEnvironment;
    let mockProvisioning: ProvisioningService;
    let mockFixPattern: FixPatternService;
    let service: DependencySolverService;
    let mockConfig: AppConfig;
    let logCallback: any;

    beforeEach(() => {
        mockSandbox = {
            writeFile: vi.fn(),
            readFile: vi.fn(),
        } as any;

        mockProvisioning = {
            runPipDryRunReport: vi.fn(),
            runPipCheck: vi.fn(),
            runPipCompile: vi.fn(),
            runPipInstall: vi.fn(),
        } as any;

        mockFixPattern = {
            analyzePipReportForConflicts: vi.fn(),
            generateRelaxationSuggestion: vi.fn(),
        } as any;

        service = new DependencySolverService(mockSandbox, {
            provisioning: mockProvisioning,
            fixPattern: mockFixPattern
        });

        mockConfig = {} as any;
        logCallback = vi.fn();
    });

    it('should solve conflicts successfully when dry run reveals conflicts and LLM suggests a fix', async () => {
        // 1. Dry run report
        const mockReport = '{"install": []}';
        vi.mocked(mockProvisioning.runPipDryRunReport).mockResolvedValue(mockReport);

        // 2. Analyze conflicts
        vi.mocked(mockFixPattern.analyzePipReportForConflicts).mockReturnValue(['Conflict 1']);

        // 3. LLM Suggestion
        const mockSuggestion = 'pkg>=1.0.0';
        vi.mocked(mockFixPattern.generateRelaxationSuggestion).mockResolvedValue(mockSuggestion);

        // 4. Pip Compile (Mock success)
        vi.mocked(mockProvisioning.runPipCompile).mockResolvedValue('pkg==1.2.0');

        // 5. Final Install & Check
        vi.mocked(mockProvisioning.runPipInstall).mockResolvedValue({ success: true, output: 'ok' });
        vi.mocked(mockProvisioning.runPipCheck).mockResolvedValue({ success: true, output: 'ok' });

        const result = await service.solvePythonConflicts(mockConfig, 'pkg==1.0.0', logCallback);

        expect(result.success).toBe(true);
        expect(result.modifiedRequirements).toBe('pkg==1.2.0');
        expect(logCallback).toHaveBeenCalledWith('SUCCESS', 'Dependencies resolved and verified successfully.');
    });

    it('should fail if pip dry run report fails', async () => {
        vi.mocked(mockProvisioning.runPipDryRunReport).mockResolvedValue(null);

        const result = await service.solvePythonConflicts(mockConfig, 'reqs', logCallback);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to generate pip dry-run report');
    });

    it('should fail if LLM provides no suggestion', async () => {
        vi.mocked(mockProvisioning.runPipDryRunReport).mockResolvedValue('{}');
        vi.mocked(mockFixPattern.analyzePipReportForConflicts).mockReturnValue(['Conflict']);
        vi.mocked(mockFixPattern.generateRelaxationSuggestion).mockResolvedValue(null); // No suggestion

        const result = await service.solvePythonConflicts(mockConfig, 'reqs', logCallback);

        expect(result.success).toBe(false);
        expect(result.error).toContain('LLM failed to provide a valid relaxation suggestion');
    });

    it('should handle pip-compile failure by falling back to suggestion', async () => {
        vi.mocked(mockProvisioning.runPipDryRunReport).mockResolvedValue('{}');
        vi.mocked(mockFixPattern.analyzePipReportForConflicts).mockReturnValue(['Conflict']);
        vi.mocked(mockFixPattern.generateRelaxationSuggestion).mockResolvedValue('pkg>=1.0');
        
        // Pip compile fails (returns null)
        vi.mocked(mockProvisioning.runPipCompile).mockResolvedValue(null);

        // Install & Check pass
        vi.mocked(mockProvisioning.runPipInstall).mockResolvedValue({ success: true, output: 'ok' });
        vi.mocked(mockProvisioning.runPipCheck).mockResolvedValue({ success: true, output: 'ok' });

        const result = await service.solvePythonConflicts(mockConfig, 'reqs', logCallback);

        expect(result.success).toBe(true);
        expect(result.modifiedRequirements).toBe('pkg>=1.0'); // Fallback to suggestion
        expect(logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('pip-compile failed'));
    });

    it('should fail if final verification (install) fails', async () => {
        vi.mocked(mockProvisioning.runPipDryRunReport).mockResolvedValue('{}');
        vi.mocked(mockFixPattern.analyzePipReportForConflicts).mockReturnValue(['Conflict']);
        vi.mocked(mockFixPattern.generateRelaxationSuggestion).mockResolvedValue('pkg>=1.0');
        vi.mocked(mockProvisioning.runPipCompile).mockResolvedValue('pkg==1.2');

        // Install fails
        vi.mocked(mockProvisioning.runPipInstall).mockResolvedValue({ success: false, output: 'Install Error' });

        const result = await service.solvePythonConflicts(mockConfig, 'reqs', logCallback);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Installation failed after relaxation');
    });
});
