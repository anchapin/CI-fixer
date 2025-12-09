
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  extractCode, 
  diagnoseError, 
  judgeFix, 
  runDevShellCommand, 
  toolLintCheck,
  toolCodeSearch
} from '../../services';
import { AppConfig } from '../../types';

// Hoist mocks to ensure they are available for module mocking
const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  e2bExec: vi.fn(),
  e2bClose: vi.fn(),
  e2bCreate: vi.fn()
}));

// Mock global fetch
globalThis.fetch = vi.fn();

// Mock GoogleGenAI
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mocks.generateContent
      }
    })),
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER' }
  };
});

// Mock E2B Code Interpreter
vi.mock('@e2b/code-interpreter', () => {
  const MockCI = {
    create: mocks.e2bCreate
  };
  return {
    CodeInterpreter: MockCI,
    default: { CodeInterpreter: MockCI },
    // Simulate named export availability on the module object for the "import * as" usage
    __esModule: true,
    ...MockCI
  };
});

describe('Service Utility Unit Tests', () => {

  const mockConfig: AppConfig = {
    githubToken: 'token',
    repoUrl: 'owner/repo',
    selectedRuns: [],
    devEnv: 'simulation',
    checkEnv: 'simulation'
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
        expect(mocks.e2bCreate).not.toHaveBeenCalled();
    });

    it('should use E2B if configured and key present', async () => {
        const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'test-key' };
        
        // Mock Sandbox instance
        const mockSandbox = {
            notebook: {
                execCell: mocks.e2bExec
            },
            close: mocks.e2bClose
        };
        mocks.e2bCreate.mockResolvedValue(mockSandbox);
        mocks.e2bExec.mockResolvedValue({
            logs: { stdout: ['file1'], stderr: [] },
            text: 'result',
            error: null
        });

        const res = await runDevShellCommand(e2bConfig, 'ls');
        
        expect(mocks.e2bCreate).toHaveBeenCalledWith({ apiKey: 'test-key' });
        expect(mocks.e2bExec).toHaveBeenCalledWith('ls');
        expect(res.output).toContain('result');
        expect(res.output).toContain('file1');
        expect(mocks.e2bClose).toHaveBeenCalled();
    });

    it('should handle E2B errors gracefully', async () => {
        const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'test-key' };
        mocks.e2bCreate.mockRejectedValue(new Error('API Error'));
        
        const res = await runDevShellCommand(e2bConfig, 'ls');
        expect(res.exitCode).toBe(1);
        expect(res.output).toContain('E2B Execution Failed');
    });
  });

  describe('toolLintCheck', () => {
    it('should use E2B for python linting when enabled', async () => {
        const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'test-key' };
        
        const mockSandbox = {
            notebook: { execCell: mocks.e2bExec },
            close: mocks.e2bClose
        };
        mocks.e2bCreate.mockResolvedValue(mockSandbox);
        
        // Simulate Syntax Error
        mocks.e2bExec.mockResolvedValue({
            logs: { stdout: [], stderr: ['SyntaxError: invalid syntax'] },
            error: { name: 'Error', value: '1', traceback: [] }
        });

        const res = await toolLintCheck(e2bConfig, 'def bad code', 'python');
        
        expect(res.valid).toBe(false);
        expect(res.error).toContain('SyntaxError');
        expect(mocks.e2bExec).toHaveBeenCalledWith(expect.stringContaining('py_compile'));
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
          const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'key' };
          const mockSandbox = {
            notebook: { execCell: mocks.e2bExec },
            close: mocks.e2bClose
          };
          mocks.e2bCreate.mockResolvedValue(mockSandbox);
          mocks.e2bExec.mockResolvedValue({
            logs: { stdout: ['src/main.py:import foo', 'src/utils.py:import foo'], stderr: [] },
            error: null
          });

          const results = await toolCodeSearch(e2bConfig, 'foo');
          expect(results).toEqual(['src/main.py', 'src/utils.py']);
          expect(mocks.e2bExec).toHaveBeenCalledWith(expect.stringContaining('grep -r "foo"'));
      });

      it('should return empty in simulation mode', async () => {
          const results = await toolCodeSearch(mockConfig, 'foo');
          expect(results).toEqual([]);
      });
  });
});
