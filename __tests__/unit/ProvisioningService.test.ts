import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';
import { SandboxEnvironment } from '../../sandbox';

describe('ProvisioningService', () => {
  let mockSandbox: SandboxEnvironment;

  beforeEach(() => {
    mockSandbox = {
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      deleteFile: vi.fn(), // Added deleteFile mock
      teardown: vi.fn(),
    } as any;
  });

  it('should install missing node tools using npm', async () => {
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: 'success', stderr: '', exitCode: 0 });

    const service = new ProvisioningService(mockSandbox);
    const result = await service.provision('vitest', 'node');

    expect(result).toBe(true);
    expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm install -g vitest');
  });

  it('should install missing python tools using pip', async () => {
    // Updated expectation to the robust pip install command
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: 'success', stderr: '', exitCode: 0 });

    const service = new ProvisioningService(mockSandbox);
    const result = await service.provision('pytest', 'python');

    expect(result).toBe(true);
    expect(vi.mocked(mockSandbox.runCommand).mock.calls[0][0]).toContain('python3 -m pip install --user pytest || python -m pip install --user pytest || pip install --user pytest');
  });

  it('should return false if installation fails', async () => {
    vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: 'error', exitCode: 1 });

    const service = new ProvisioningService(mockSandbox);
    const result = await service.provision('vitest', 'node');

    expect(result).toBe(false);
  });

  describe('runPipDryRunReport', () => {
    const mockRequirementsContent = "requests==2.31.0";
    const mockReportContent = '{"install": [{"metadata": {"name": "requests", "version": "2.31.0"}}]}';

    beforeEach(() => {
        // Clear mocks before each test in this describe block
        vi.mocked(mockSandbox.writeFile).mockClear();
        vi.mocked(mockSandbox.readFile).mockClear();
        vi.mocked(mockSandbox.deleteFile).mockClear();
        vi.mocked(mockSandbox.runCommand).mockClear();

        vi.mocked(mockSandbox.writeFile).mockResolvedValue(undefined);
        vi.mocked(mockSandbox.readFile).mockResolvedValue(mockReportContent);
        vi.mocked(mockSandbox.deleteFile).mockResolvedValue(undefined);
    });

    it('should successfully execute dry run and return report', async () => {
        // Mock runCommand specifically for this test case
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

        const service = new ProvisioningService(mockSandbox);
        const report = await service.runPipDryRunReport(mockRequirementsContent);

        expect(mockSandbox.writeFile).toHaveBeenCalledWith(expect.stringContaining('requirements-'), mockRequirementsContent);
        // Using expect.stringMatching for the command due to the `||` operators
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringMatching(/python3 -m pip install -r requirements-\d+\.txt --dry-run --report pip_report-\d+\.json \|\| python -m pip install -r requirements-\d+\.txt --dry-run --report pip_report-\d+\.json/));
        expect(mockSandbox.readFile).toHaveBeenCalledWith(expect.stringMatching(/pip_report-\d+\.json/));
        expect(mockSandbox.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/requirements-\d+\.txt/));
        expect(mockSandbox.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/pip_report-\d+\.json/));
        expect(report).toEqual(mockReportContent);
    });

    it('should return null if pip command fails', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: 'pip error', exitCode: 1 });

        const service = new ProvisioningService(mockSandbox);
        const report = await service.runPipDryRunReport(mockRequirementsContent);

        expect(report).toBeNull();
        expect(mockSandbox.writeFile).toHaveBeenCalled();
        expect(mockSandbox.deleteFile).toHaveBeenCalledTimes(2); // Should still clean up
    });

    it('should return null if reading report file fails', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        vi.mocked(mockSandbox.readFile).mockRejectedValue(new Error('File read error'));

        const service = new ProvisioningService(mockSandbox);
        const report = await service.runPipDryRunReport(mockRequirementsContent);

        expect(report).toBeNull();
        expect(mockSandbox.writeFile).toHaveBeenCalled();
        expect(mockSandbox.deleteFile).toHaveBeenCalledTimes(2); // Should still clean up
    });
  });

  describe('runPipCompile', () => {
    const mockRequirementsInContent = "requests\n";
    const mockCompiledRequirementsTxt = "requests==2.31.0\n";

    let service: ProvisioningService;

    beforeEach(() => {
        service = new ProvisioningService(mockSandbox);
        vi.spyOn(service, 'provision').mockResolvedValue(true); // Assume piptools is installed
        vi.mocked(mockSandbox.writeFile).mockClear();
        vi.mocked(mockSandbox.readFile).mockClear();
        vi.mocked(mockSandbox.deleteFile).mockClear();
        vi.mocked(mockSandbox.runCommand).mockClear();
        
        vi.mocked(mockSandbox.writeFile).mockResolvedValue(undefined);
        vi.mocked(mockSandbox.readFile).mockResolvedValue(mockCompiledRequirementsTxt);
        vi.mocked(mockSandbox.deleteFile).mockResolvedValue(undefined);
    });

    it('should successfully execute pip-compile and return requirements.txt', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }); // for pip-compile command

        const compiledContent = await service.runPipCompile(mockRequirementsInContent);

        expect(service.provision).toHaveBeenCalledWith('piptools', 'python');
        expect(mockSandbox.writeFile).toHaveBeenCalledWith(expect.stringMatching(/requirements-\d+\.in/), mockRequirementsInContent);
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringMatching(/python3 -m piptools compile requirements-\d+\.in -o requirements-\d+\.txt \|\| python -m piptools compile requirements-\d+\.in -o requirements-\d+\.txt/));
        expect(mockSandbox.readFile).toHaveBeenCalledWith(expect.stringMatching(/requirements-\d+\.txt/));
        expect(mockSandbox.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/requirements-\d+\.in/));
        expect(mockSandbox.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/requirements-\d+\.txt/));
        expect(compiledContent).toEqual(mockCompiledRequirementsTxt);
    });

    it('should return null if pip-tools installation fails', async () => {
        vi.spyOn(service, 'provision').mockResolvedValue(false); // Simulate piptools not installed

        const compiledContent = await service.runPipCompile(mockRequirementsInContent);

        expect(compiledContent).toBeNull();
        expect(service.provision).toHaveBeenCalledWith('piptools', 'python');
        expect(mockSandbox.writeFile).not.toHaveBeenCalled(); // Should not write files if tool not installed
    });

    it('should return null if pip-compile command fails', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: 'compile error', exitCode: 1 });

        const compiledContent = await service.runPipCompile(mockRequirementsInContent);

        expect(compiledContent).toBeNull();
        expect(mockSandbox.writeFile).toHaveBeenCalled();
        expect(mockSandbox.deleteFile).toHaveBeenCalledTimes(2); // Still clean up temp files
    });

    it('should return null if reading requirements.txt fails', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        vi.mocked(mockSandbox.readFile).mockRejectedValue(new Error('File read error'));

        const compiledContent = await service.runPipCompile(mockRequirementsInContent);

        expect(compiledContent).toBeNull();
        expect(mockSandbox.writeFile).toHaveBeenCalled();
        expect(mockSandbox.deleteFile).toHaveBeenCalledTimes(2); // Still clean up temp files
    });
  });

  describe('Verification Methods', () => {
    let service: ProvisioningService;

    beforeEach(() => {
        service = new ProvisioningService(mockSandbox);
        vi.mocked(mockSandbox.runCommand).mockClear();
    });

    it('runPipCheck should return success when pip check passes', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: 'No conflicts found', stderr: '', exitCode: 0 });

        const result = await service.runPipCheck();

        expect(result.success).toBe(true);
        expect(result.output).toBe('No conflicts found');
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringContaining('pip check'));
    });

    it('runPipCheck should return failure when pip check fails', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: '', stderr: 'Conflicts detected', exitCode: 1 });

        const result = await service.runPipCheck();

        expect(result.success).toBe(false);
        expect(result.output).toBe('Conflicts detected');
    });

    it('runPipInstall should return success when installation succeeds', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: 'Successfully installed', stderr: '', exitCode: 0 });

        const result = await service.runPipInstall('custom-requirements.txt');

        expect(result.success).toBe(true);
        expect(mockSandbox.runCommand).toHaveBeenCalledWith(expect.stringContaining('pip install -r custom-requirements.txt'));
    });

    it('runProjectTests should return success when tests pass', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: 'Tests passed', stderr: '', exitCode: 0 });

        const result = await service.runProjectTests('npm test');

        expect(result.success).toBe(true);
        expect(result.output).toBe('Tests passed');
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm test');
    });

    it('runProjectTests should return failure when tests fail', async () => {
        vi.mocked(mockSandbox.runCommand).mockResolvedValue({ stdout: 'Tests failed', stderr: '', exitCode: 1 });

        const result = await service.runProjectTests('npm test');

        expect(result.success).toBe(false);
        expect(result.output).toBe('Tests failed');
    });
  });
});

