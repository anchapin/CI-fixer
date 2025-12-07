
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AgentPhase, AppConfig, RunGroup, WorkflowRun } from '../../types';

// Mock all internal service calls
vi.mock('../../services', async (importOriginal) => {
  return {
    getWorkflowLogs: vi.fn(),
    toolScanDependencies: vi.fn(),
    toolCodeSearch: vi.fn(),
    diagnoseError: vi.fn(),
    generateDetailedPlan: vi.fn(),
    judgeDetailedPlan: vi.fn(),
    findClosestFile: vi.fn(),
    toolWebSearch: vi.fn(),
    generateFix: vi.fn(),
    toolLintCheck: vi.fn(),
    judgeFix: vi.fn(),
    runSandboxTest: vi.fn(),
  };
});

import * as services from '../../services';

describe('Agent Loop Integration', () => {
  const mockConfig: AppConfig = {
    githubToken: 'mock-token',
    repoUrl: 'owner/repo',
    selectedRuns: [],
    llmProvider: 'gemini'
  };

  const mockGroup: RunGroup = {
    id: 'group-1',
    name: 'CI Test',
    runIds: [101],
    mainRun: { id: 101, name: 'CI Test', path: 'ci.yml' } as WorkflowRun
  };

  const updateStateCallback = vi.fn();
  const logCallback = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Set default safe returns for optional tools to prevent undefined errors
    vi.mocked(services.toolScanDependencies).mockResolvedValue("No dependencies found");
    vi.mocked(services.toolCodeSearch).mockResolvedValue([]);
    vi.mocked(services.toolWebSearch).mockResolvedValue("No results");
  });

  it('should successfully fix a bug in one iteration with File Reservation Protocol', async () => {
    // 1. Understand Phase Mocks
    vi.mocked(services.getWorkflowLogs).mockResolvedValue({ 
        logText: "Error: Division by zero", 
        jobName: "test", 
        headSha: "abc" 
    });
    vi.mocked(services.diagnoseError).mockResolvedValue({ 
        summary: "Division by zero in calc.py", 
        filePath: "src/calc.py" 
    });

    // 2. Implement Phase Mocks
    vi.mocked(services.findClosestFile).mockResolvedValue({
        file: {
            name: "calc.py",
            language: "python",
            content: "def div(a, b): return a / b",
            sha: "123"
        },
        path: "src/calc.py"
    });
    vi.mocked(services.generateFix).mockResolvedValue("def div(a, b): return a / b if b != 0 else 0");
    vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });

    // 3. Verify Phase Mocks (Judge)
    vi.mocked(services.judgeFix).mockResolvedValue({ 
        passed: true, 
        score: 10, 
        reasoning: "Perfect fix" 
    });

    // 4. Sandbox Phase Mocks
    vi.mocked(services.runSandboxTest).mockResolvedValue({ 
        passed: true, 
        logs: "Tests Passed" 
    });

    // Run the loop
    const finalState = await runIndependentAgentLoop(
        mockConfig, 
        mockGroup, 
        "Repo Context", 
        updateStateCallback, 
        logCallback
    );

    // Assertions for Success State
    expect(finalState.status).toBe('success');
    expect(finalState.phase).toBe(AgentPhase.SUCCESS);
    
    // Assertions for Protocol: Verify File Locking Steps
    // 1. Should transition to ACQUIRE_LOCK
    expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id, 
        expect.objectContaining({ phase: AgentPhase.ACQUIRE_LOCK })
    );
    
    // 2. Should actually hold a reservation for the diagnosed file
    expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id,
        expect.objectContaining({ fileReservations: ["src/calc.py"] })
    );

    // 3. Should RELEASE the lock at end of successful run (fileReservations becomes empty)
    expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id,
        expect.objectContaining({ fileReservations: [] })
    );

    // Basic Service Calls
    expect(services.generateFix).toHaveBeenCalled();
    expect(services.runSandboxTest).toHaveBeenCalled();
  });

  it('should handle failure after max retries and invoke tools during retry', async () => {
     // Mock consistent failure
     vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "Error", jobName: "job", headSha: "123" });
     vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Error", filePath: "file.py" });
     vi.mocked(services.findClosestFile).mockResolvedValue({ 
        file: { name: "file.py", language: "python", content: "code" },
        path: "file.py"
     });
     
     // Judge rejects fix repeatedly
     vi.mocked(services.generateFix).mockResolvedValue("bad code");
     vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });
     vi.mocked(services.judgeFix).mockResolvedValue({ passed: false, score: 2, reasoning: "Bad code" });

     // Mock Plan generation for retries
     vi.mocked(services.generateDetailedPlan).mockResolvedValue({ goal: "fix", tasks: [], approved: true });
     vi.mocked(services.judgeDetailedPlan).mockResolvedValue({ approved: true, feedback: "ok" });

     const finalState = await runIndependentAgentLoop(
         mockConfig, mockGroup, "", updateStateCallback, logCallback
     );

     expect(finalState.status).toBe('failed');
     expect(finalState.phase).toBe(AgentPhase.FAILURE);
     
     // Should have retried 3 times (loop 0, 1, 2)
     expect(services.judgeFix).toHaveBeenCalledTimes(3);
     
     // Web Search should be called during retry iterations (iteration > 0)
     expect(services.toolWebSearch).toHaveBeenCalled();

     // Protocol: Should attempt to release locks even on failure loops
     expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id,
        expect.objectContaining({ fileReservations: [] })
    );
  });

  it('should self-correct syntax errors during IMPLEMENT phase', async () => {
     // Understand Phase
     vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "SyntaxError", jobName: "job", headSha: "123" });
     vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Syntax Error", filePath: "file.py" });
     vi.mocked(services.findClosestFile).mockResolvedValue({ file: { name: "file.py", content: "code", language: "python" }, path: "file.py" });
     
     // 1. First Fix Generation (Bad Syntax)
     vi.mocked(services.generateFix).mockResolvedValueOnce("def foo( : pass"); // Missing closing param
     
     // 2. Linter Checks
     vi.mocked(services.toolLintCheck)
        .mockResolvedValueOnce({ valid: false, error: "Invalid syntax" }) // First check fails
        .mockResolvedValueOnce({ valid: true }); // Second check (after self-correct) passes

     // 3. Self-Correction Generation
     vi.mocked(services.generateFix).mockResolvedValueOnce("def foo(): pass"); // Corrected

     // 4. Verify/Sandbox
     vi.mocked(services.judgeFix).mockResolvedValue({ passed: true, score: 9, reasoning: "Good" });
     vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "PASS" });

     const finalState = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

     expect(finalState.status).toBe('success');
     
     // Should have called generateFix twice (Initial + Self-Correction)
     expect(services.generateFix).toHaveBeenCalledTimes(2);
     
     // Should have called Linter twice
     expect(services.toolLintCheck).toHaveBeenCalledTimes(2);
     
     // Check logs for self-correction message
     expect(logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('Agent attempting self-correction'), expect.anything(), expect.anything());
  });
});
