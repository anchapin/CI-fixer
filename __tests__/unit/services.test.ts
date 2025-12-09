
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractCode, groupFailedRuns, diagnoseError, generateWorkflowOverride, runSandboxTest } from '../../services';
import { WorkflowRun, AppConfig, RunGroup, FileChange } from '../../types';

// Use vi.hoisted to ensure the mock function is created before the mock factory runs
const mocks = vi.hoisted(() => ({
  generateContent: vi.fn()
}));

// Mock dependencies
globalThis.fetch = vi.fn();

// Partial mock for GoogleGenAI
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

describe('Service Utility Unit Tests', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractCode', () => {
    it('should extract code from markdown code blocks', () => {
      const input = "Here is the code:\n```python\nprint('hello')\n```";
      const result = extractCode(input, 'python');
      expect(result).toBe("print('hello')");
    });

    it('should handle code blocks without language specifier', () => {
      const input = "```\nconst x = 1;\n```";
      const result = extractCode(input, 'javascript');
      expect(result).toBe("const x = 1;");
    });

    it('should strip prompt leakage like "Return JSON:"', () => {
      const input = "Return JSON: {\"key\": \"value\"}";
      const result = extractCode(input, 'json');
      expect(result).toBe("{\"key\": \"value\"}");
    });

    it('should clean up common python import hallucinations', () => {
      const input = "Python code:\nimport os\nprint(os.getcwd())";
      const result = extractCode(input, 'python');
      // The function removes text before imports
      expect(result).toBe("import os\nprint(os.getcwd())"); 
    });

    it('should NOT strip comments or shebangs at start of python file', () => {
        const input = "#!/usr/bin/env python\nimport os";
        const result = extractCode(input, 'python');
        expect(result).toBe("#!/usr/bin/env python\nimport os");
    });

    it('should NOT strip block comments at start of js file', () => {
        const input = "/*\n * License Header\n */\nimport React from 'react';";
        const result = extractCode(input, 'javascript');
        expect(result).toBe("/*\n * License Header\n */\nimport React from 'react';");
    });

    it('should handle nested markdown blocks (docstrings containing backticks)', () => {
        // Simulating LLM response using 4 backticks to wrap 3 backticks
        const input = `Here is the corrected code:
\`\`\`\`python
def example():
    """
    Example usage:
    \`\`\`
    code_inside_docstring()
    \`\`\`
    """
    return True
\`\`\`\`
`;
        const result = extractCode(input, 'python');
        const expected = `def example():
    """
    Example usage:
    \`\`\`
    code_inside_docstring()
    \`\`\`
    """
    return True`;
        expect(result.trim()).toBe(expected);
    });

    it('should handle C# language identifiers', () => {
      const input = "```c#\nConsole.WriteLine(\"Hello\");\n```";
      const result = extractCode(input, 'c#');
      expect(result).toBe('Console.WriteLine("Hello");');
    });

    it('should handle loose whitespace after language identifier', () => {
      const input = "```python  \nprint('hello')\n```";
      const result = extractCode(input, 'python');
      expect(result).toBe("print('hello')");
    });

    it('should handle code blocks with filename metadata', () => {
      const input = "```python filename=\"main.py\"\nprint('hello')\n```";
      const result = extractCode(input, 'python');
      expect(result).toBe("print('hello')");
    });

    it('should handle prompt leakage with leading whitespace', () => {
        const input = "   Here is the code:\n    def foo(): pass";
        const result = extractCode(input, 'python');
        // It should match "Here is the code" even with leading spaces
        // And then regex should find def and strip pre-amble
        expect(result).toContain("def foo(): pass");
    });

    it('should prioritize specific language block over first block', () => {
        const input = `
Here is the command to run:
\`\`\`bash
npm install
\`\`\`

And here is the file content:
\`\`\`javascript
const a = 1;
\`\`\`
`;
        // Request javascript. Should ignore the bash block.
        const result = extractCode(input, 'javascript');
        expect(result).toBe("const a = 1;");
    });

    it('should handle language aliases (e.g. jsx for javascript)', () => {
        const input = "```jsx\n<div>Hello</div>\n```";
        const result = extractCode(input, 'javascript');
        expect(result).toBe("<div>Hello</div>");
    });

    it('should properly extract typescript via alias regex (tsx)', () => {
        const input = "```tsx\nconst x: number = 1;\n```";
        const result = extractCode(input, 'typescript');
        expect(result).toBe("const x: number = 1;");
    });

    it('should return the LAST code block if multiple exist of same language', () => {
        const input = `
Here is the original broken code:
\`\`\`python
def broken(): error
\`\`\`

And here is the corrected version:
\`\`\`python
def broken(): fixed
\`\`\`
`;
        const result = extractCode(input, 'python');
        // This is a CRITICAL heuristic for "Fix Code" tasks
        expect(result.trim()).toBe("def broken(): fixed");
    });

    it('should return the LAST generic block if no specific language found', () => {
        const input = `
Original:
\`\`\`
old
\`\`\`

Fixed:
\`\`\`
new
\`\`\`
`;
        const result = extractCode(input, 'python');
        expect(result.trim()).toBe("new");
    });

    it('should find the LAST non-shell block if specific language not found', () => {
        // This simulates a scenario where model outputs multiple blocks, none marked as 'python',
        // but we asked for python. It should skip the bash block, skip the 'original' block (conceptually),
        // and grab the LAST block that isn't shell.
        const input = `
Run this:
\`\`\`bash
pip install x
\`\`\`

Original code:
\`\`\`
def old(): pass
\`\`\`

Fixed code:
\`\`\`
def new(): pass
\`\`\`
`;
        const result = extractCode(input, 'python');
        expect(result.trim()).toBe("def new(): pass");
    });

    it('should avoid the "Original" block if a "Fixed" block exists', () => {
        const input = `
Here is the original buggy code:
\`\`\`python
def example():
    bug()
\`\`\`

And here is the fixed solution:
\`\`\`python
def example():
    fixed()
\`\`\`
`;
        const result = extractCode(input, 'python');
        expect(result.trim()).toBe("def example():\n    fixed()");
    });

    it('should fallback to the "Original" block if it is the only one available', () => {
        const input = `
Here is the original code you provided:
\`\`\`python
def only_one():
    pass
\`\`\`
`;
        const result = extractCode(input, 'python');
        expect(result.trim()).toBe("def only_one():\n    pass");
    });

    it('should NOT strip valid script code before imports (if no markdown used)', () => {
        // This simulates a raw response where the model forgets code blocks
        // The script starts with print statements before imports.
        const input = `print("Starting script...")
import os
import sys

def main():
    pass`;
        const result = extractCode(input, 'python');
        // Previously, the aggressive heuristic might have stripped the first line
        expect(result).toBe(input);
    });

    it('should normalize indentation in fallback raw text', () => {
        // Simulates an LLM response where it forgot backticks but indented the whole block
        const input = "    def indented():\n        pass";
        const result = extractCode(input, 'python');
        expect(result).toBe("def indented():\n    pass");
    });
  });

  describe('generateWorkflowOverride', () => {
      it('should generate a valid workflow override prompt', async () => {
          mocks.generateContent.mockResolvedValue({ 
              text: "```yaml\nname: test\non:\n  push:\n    branches: ['agent/test']\n```" 
          });
          
          const result = await generateWorkflowOverride(
              {} as any, 
              "original workflow content", 
              "agent/test", 
              "Error in test_main"
          );
          
          expect(result).toContain("name: test");
          expect(result).toContain("branches: ['agent/test']");
          
          const callArgs = mocks.generateContent.mock.calls[mocks.generateContent.mock.calls.length - 1][0];
          expect(callArgs.contents).toContain("agent/test");
          expect(callArgs.contents).toContain("Error in test_main");
      });
  });

  describe('diagnoseError (safeJsonParse internal)', () => {
      // Testing the robustness of JSON extraction via the diagnoseError wrapper which uses safeJsonParse
      it('should extract JSON from messy preamble text', async () => {
          const messyOutput = `
          Sure, I analyzed the logs.
          Here is the JSON you requested:
          \`\`\`json
          {
            "summary": "Fix found",
            "filePath": "src/main.ts"
          }
          \`\`\`
          Hope this helps!
          `;
          
          mocks.generateContent.mockResolvedValue({ text: messyOutput });
          
          const result = await diagnoseError({} as any, "log");
          expect(result.summary).toBe("Fix found");
      });

      it('should extract JSON embedded without markdown', async () => {
          const output = `The result is {"summary": "Error 1", "filePath": "test.js"} check it out.`;
          mocks.generateContent.mockResolvedValue({ text: output });
          
          const result = await diagnoseError({} as any, "log");
          expect(result.summary).toBe("Error 1");
      });

      it('should extract the LAST JSON object if multiple exist in text', async () => {
          const output = `
          Thought:
          {
             "reasoning": "I think it is main.py"
          }
          
          Final Answer:
          {
             "summary": "Syntax Error",
             "filePath": "src/main.py"
          }
          `;
          mocks.generateContent.mockResolvedValue({ text: output });
          
          // Should grab the second one because it's the last one
          const result = await diagnoseError({} as any, "log");
          expect(result.summary).toBe("Syntax Error");
      });

      it('should handle nested objects in multi-JSON scenarios', async () => {
          const output = `
          Step 1:
          { "a": { "b": 1 } }

          Step 2:
          { "summary": "Error", "extra": { "detail": 1 } }
          `;
          mocks.generateContent.mockResolvedValue({ text: output });
          
          const result = await diagnoseError({} as any, "log");
          expect(result.summary).toBe("Error");
      });

      it('should handle garbage at the end of the JSON string', async () => {
          const output = `
          { "summary": "Garbage Test", "filePath": "main.py" }
          
          Note: This is the end. } <-- Stray bracket.
          `;
          mocks.generateContent.mockResolvedValue({ text: output });
          
          const result = await diagnoseError({} as any, "log");
          // It should skip the stray bracket at the end and find the real object
          expect(result.summary).toBe("Garbage Test");
      });
  });

  describe('groupFailedRuns', () => {
    it('should group runs by workflow name', async () => {
      const runs: WorkflowRun[] = [
        { id: 1, name: 'Test CI', path: 'ci.yml', status: 'completed', conclusion: 'failure', head_sha: 'abc', html_url: '' },
        { id: 2, name: 'Test CI', path: 'ci.yml', status: 'completed', conclusion: 'failure', head_sha: 'abc', html_url: '' },
        { id: 3, name: 'Deploy', path: 'deploy.yml', status: 'completed', conclusion: 'failure', head_sha: 'abc', html_url: '' }
      ];

      const groups = await groupFailedRuns({} as any, runs);
      
      expect(groups).toHaveLength(2);
      const testCiGroup = groups.find(g => g.name === 'Test CI');
      expect(testCiGroup).toBeDefined();
      expect(testCiGroup?.runIds).toEqual([1, 2]);
      
      const deployGroup = groups.find(g => g.name === 'Deploy');
      expect(deployGroup?.runIds).toEqual([3]);
    });
  });

  describe('runSandboxTest (Mental Walkthrough)', () => {
      const mockConfig: AppConfig = {
          githubToken: 'mock',
          repoUrl: 'owner/repo',
          selectedRuns: [],
          sandboxMode: 'simulation'
      };
      
      const mockGroup: RunGroup = {
          id: 'g1',
          name: 'group1',
          runIds: [1],
          mainRun: { id: 1, name: 'run1', path: 'ci.yml' } as any
      };

      const mockFileChange: FileChange = {
          path: 'src/main.ts',
          original: { name: 'main.ts', content: 'orig', language: 'ts' },
          modified: { name: 'main.ts', content: 'fixed', language: 'ts' },
          status: 'modified'
      };

      it('should return simple success if simulation passes', async () => {
          // Mock successful simulation
          mocks.generateContent.mockResolvedValueOnce({ 
              text: JSON.stringify({ passed: true, logs: "Tests passed." }) 
          });

          const result = await runSandboxTest(mockConfig, mockGroup, 0, true, mockFileChange, "Error 1", () => {}, {});
          
          expect(result.passed).toBe(true);
          expect(result.logs).toContain("Tests passed");
          // Should not call Mental Walkthrough (2nd call)
          expect(mocks.generateContent).toHaveBeenCalledTimes(1);
      });

      it('should trigger Mental Walkthrough on failure and prepend analysis', async () => {
          // 1. Mock Failed Simulation
          mocks.generateContent.mockResolvedValueOnce({ 
              text: JSON.stringify({ passed: false, logs: "Error: ReferenceError: x is not defined" }) 
          });

          // 2. Mock Mental Walkthrough Analysis
          mocks.generateContent.mockResolvedValueOnce({ 
              text: "PROGRESS: The error changed from SyntaxError to ReferenceError." 
          });

          const result = await runSandboxTest(mockConfig, mockGroup, 0, true, mockFileChange, "SyntaxError", () => {}, {});
          
          expect(result.passed).toBe(false);
          // Crucial: Analysis must be at the TOP (prepended)
          expect(result.logs).toContain("--- MENTAL WALKTHROUGH ---");
          expect(result.logs).toContain("PROGRESS: The error changed");
          expect(result.logs.indexOf("PROGRESS:")).toBeLessThan(result.logs.indexOf("Error: ReferenceError"));
          
          expect(mocks.generateContent).toHaveBeenCalledTimes(2);
      });
  });

});
