import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import {
  extractCode,
  diagnoseError,
  judgeFix,
  runDevShellCommand,
  toolLintCheck,
  toolCodeSearch,
  getWorkflowLogs
} from '../../services';
import { AppConfig } from '../../types';

// Hoist mocks to ensure they are available for module mocking
const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  sandboxRunCode: vi.fn(),
  sandboxKill: vi.fn(),
  sandboxCreate: vi.fn()
}));

// Mock GoogleGenAI
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn(function () {
      return {
        models: {
          generateContent: mocks.generateContent
        }
      };
    }),
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' }
  };
});

// Mock E2B Code Interpreter
vi.mock('@e2b/code-interpreter', () => {
  const MockSandbox = {
    create: mocks.sandboxCreate
  };
  return {
    Sandbox: MockSandbox,
    // Simulate named export availability on the module object for the "import * as" usage
    __esModule: true,
    ...MockSandbox
  };
});

describe('Service Utility Unit Tests', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  const mockConfig: AppConfig = {
    githubToken: 'token',
    repoUrl: 'owner/repo',
    selectedRuns: [],
    devEnv: 'simulation',
    checkEnv: 'simulation'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy.mockReset();
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  describe('extractCode', () => {
    it('should extract code from markdown code blocks', () => {
      const input = "Here is the code:\n```python\nprint('hello')\n```";
      const result = extractCode(input, 'python');
      expect(result).toBe("print('hello')");
    });

    it('should fallback to generic blocks if language mismatch', () => {
      const input = "```\nconst x = 1;\n```";
      const result = extractCode(input, 'javascript');
      expect(result).toBe("const x = 1;");
    });

    it('should return trimmed text if no blocks', () => {
      const input = " just raw code ";
      expect(extractCode(input)).toBe("just raw code");
    });
  });

  describe('diagnoseError', () => {
    it('should extract flat JSON correctly', async () => {
      mocks.generateContent.mockResolvedValue({
        text: '```json\n{"summary": "S", "filePath": "F"}\n```'
      });
      const result = await diagnoseError(mockConfig, "log");
      expect(result.summary).toBe("S");
    });

    it('should unwrap nested "answer" object (ZeroOperator bug)', async () => {
      mocks.generateContent.mockResolvedValue({
        text: '```json\n{ "answer": { "primaryError": "Found bug", "filePath": "src/main.ts" } }\n```'
      });
      const result = await diagnoseError(mockConfig, "log");
      expect(result.summary).toBe("Found bug");
      expect(result.filePath).toBe("src/main.ts");
    });

    it('should handle "answer" as a string (CyberSentinel bug)', async () => {
      mocks.generateContent.mockResolvedValue({
        text: '```json\n{ "answer": "Import error caused by duplicates", "filePath": "" }\n```'
      });
      const result = await diagnoseError(mockConfig, "log");
      expect(result.summary).toBe("Import error caused by duplicates");
    });

    it('should handle "result" wrapper', async () => {
      mocks.generateContent.mockResolvedValue({
        text: '```json\n{ "result": { "summary": "Bad code", "filePath": "x.py" } }\n```'
      });
      const result = await diagnoseError(mockConfig, "log");
      expect(result.summary).toBe("Bad code");
    });

    it('should recommend editing workflow for disk space errors', async () => {
      // Mock LLM to return what we expect from the new prompt instructions
      mocks.generateContent.mockResolvedValue({
        text: '```json\n{ "summary": "Disk Space Error", "filePath": ".github/workflows/ci.yml", "fixAction": "edit" }\n```'
      });

      const logWithDiskError = "OSError: [Errno 28] No space left on device";
      await diagnoseError(mockConfig, logWithDiskError);

      const callArgs = mocks.generateContent.mock.calls[mocks.generateContent.mock.calls.length - 1][0];
      // Verify the prompt contained the special rule
      expect(callArgs.contents).toContain('SPECIAL RULE');
      expect(callArgs.contents).toContain('No space left on device');
      expect(callArgs.contents).toContain('docker system prune -af');
    });
  });
  describe('judgeFix', () => {
    it('should include the code in the prompt', async () => {
      // Mock linter first
      mocks.generateContent.mockResolvedValueOnce({ text: '{"valid": true}' });
      // Mock judge response
      mocks.generateContent.mockResolvedValueOnce({ text: '{"passed": true, "score": 10, "reasoning": "ok"}' });

      await judgeFix(mockConfig, "orig", "fixed_code_value", "error");

      const callArgs = mocks.generateContent.mock.calls[mocks.generateContent.mock.calls.length - 1][0];
      expect(callArgs.contents).toContain("fixed_code_value");
    });
  });

  describe('runDevShellCommand', () => {
    it('should run in simulation mode by default', async () => {
      const res = await runDevShellCommand(mockConfig, 'ls -la');
      expect(res.output).toContain('[SIMULATION]');
      expect(res.exitCode).toBe(0);
      expect(mocks.sandboxCreate).not.toHaveBeenCalled();
    });

    it('should use E2B if configured and key present', async () => {
      const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'e2b_valid_test_key_1234567890' };

      // Mock Sandbox instance
      const mockSandboxInstance = {
        runCode: mocks.sandboxRunCode,
        kill: mocks.sandboxKill
      };
      mocks.sandboxCreate.mockResolvedValue(mockSandboxInstance);
      mocks.sandboxRunCode.mockResolvedValue({
        logs: { stdout: ['file1'], stderr: [] },
        text: 'result',
        error: null
      });

      const res = await runDevShellCommand(e2bConfig, 'ls');

      expect(mocks.sandboxCreate).toHaveBeenCalledWith({ apiKey: 'e2b_valid_test_key_1234567890' });
      expect(mocks.sandboxRunCode).toHaveBeenCalledWith('ls', { language: 'bash' });
      expect(res.output).toContain('file1');
      expect(mocks.sandboxKill).toHaveBeenCalled();
    });

    it('should handle E2B errors gracefully', async () => {
      const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'e2b_valid_test_key_1234567890' };
      mocks.sandboxCreate.mockRejectedValue(new Error('API Error'));

      const res = await runDevShellCommand(e2bConfig, 'ls');
      expect(res.exitCode).toBe(1);
      expect(res.output).toContain('E2B Exception');
    });
  });

  describe('toolLintCheck', () => {
    it('should use E2B for python linting when enabled', async () => {
      const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'e2b_valid_test_key_1234567890' };

      const mockSandboxInstance = {
        runCode: mocks.sandboxRunCode,
        kill: mocks.sandboxKill
      };
      mocks.sandboxCreate.mockResolvedValue(mockSandboxInstance);

      // Simulate Syntax Error
      mocks.sandboxRunCode.mockResolvedValue({
        logs: { stdout: [], stderr: ['SyntaxError: invalid syntax'] },
        error: { name: 'Error', value: '1', traceback: [] }
      });

      const res = await toolLintCheck(e2bConfig, 'def bad code', 'python');

      expect(res.valid).toBe(false);
      expect(res.error).toContain('SyntaxError');
      expect(mocks.sandboxRunCode).toHaveBeenCalledWith(expect.stringContaining('py_compile'), expect.any(Object));
    });

    it('should fallback to LLM linting if not python or not E2B', async () => {
      mocks.generateContent.mockResolvedValue({ text: '{"valid": true}' });
      const res = await toolLintCheck(mockConfig, 'const x = 1;', 'javascript');
      expect(res.valid).toBe(true);
      expect(mocks.generateContent).toHaveBeenCalled();
    });
  });

  describe('toolCodeSearch', () => {
    it('should use grep in E2B mode', async () => {
      const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'e2b_valid_test_key_1234567890' };
      const mockSandboxInstance = {
        runCode: mocks.sandboxRunCode,
        kill: mocks.sandboxKill
      };
      mocks.sandboxCreate.mockResolvedValue(mockSandboxInstance);
      mocks.sandboxRunCode.mockResolvedValue({
        logs: { stdout: ['src/main.py:import foo', 'src/utils.py:import foo'], stderr: [] },
        error: null
      });

      const results = await toolCodeSearch(e2bConfig, 'foo');
      expect(results).toEqual(['src/main.py', 'src/utils.py']);
      expect(mocks.sandboxRunCode).toHaveBeenCalledWith(expect.stringContaining('grep -r "foo"'), expect.any(Object));
    });

    it('should return empty in simulation mode', async () => {
      const results = await toolCodeSearch(mockConfig, 'foo');
      expect(results).toEqual([]);
    });
  });

  describe('getWorkflowLogs', () => {
    // Verified via top-level import


    it('should use standard strategy by default (finds conclusion=failure)', async () => {
      fetchSpy.mockResolvedValueOnce({ json: async () => ({ head_sha: 'sha' }) } as any); // runs
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ jobs: [{ id: 1, conclusion: 'success' }, { id: 2, conclusion: 'failure', name: 'failed_job' }] }) // jobs
      } as any);
      fetchSpy.mockResolvedValueOnce({ text: async () => "Error Log" } as any); // logs

      const result = await getWorkflowLogs(mockConfig.repoUrl, 123, 'token');
      expect(result.jobName).toBe('failed_job');
      expect(result.logText).toBe("Error Log");
    });

    it('should use extended strategy to fetch more jobs', async () => {
      fetchSpy.mockResolvedValueOnce({ json: async () => ({ head_sha: 'sha' }) } as any);
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ jobs: [] })
      } as any);

      await getWorkflowLogs(mockConfig.repoUrl, 123, 'token', 'extended');

      // Use normalized fetchSpy calls logic to check arguments
      const calls = fetchSpy.mock.calls;
      const jobsCall = calls.find(call => call[0].toString().includes('/jobs'));
      expect(jobsCall![0].toString()).toContain('per_page=100');
    });

    it('should use any_error strategy to find non-success jobs', async () => {
      fetchSpy.mockResolvedValueOnce({ json: async () => ({ head_sha: 'sha' }) } as any);
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ jobs: [{ id: 3, conclusion: 'cancelled', name: 'cancelled_job' }] })
      } as any);
      fetchSpy.mockResolvedValueOnce({ text: async () => "Cancel Log" } as any);

      const result = await getWorkflowLogs(mockConfig.repoUrl, 123, 'token', 'any_error');
      expect(result.jobName).toBe('cancelled_job');
      expect(result.logText).toBe("Cancel Log");
    });

    it('should return specific message if no job found', async () => {
      fetchSpy.mockResolvedValueOnce({ json: async () => ({ head_sha: 'sha' }) } as any);
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ jobs: [{ conclusion: 'success' }] })
      } as any);

      const result = await getWorkflowLogs(mockConfig.repoUrl, 123, 'token');
      expect(result.logText).toContain('No failed job found');
    });
  });
});
