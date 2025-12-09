
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
    llmProvider: 'gemini',
    devEnv: 'simulation',
    checkEnv: 'simulation'
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
    expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id, 
        expect.objectContaining({ phase: AgentPhase.ACQUIRE_LOCK })
    );
    expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id,
        expect.objectContaining({ fileReservations: ["src/calc.py"] })
    );
    expect(updateStateCallback).toHaveBeenCalledWith(
        mockGroup.id,
        expect.objectContaining({ fileReservations: [] })
    );
  });

  it('should fallback to summary search if diagnosis filepath is empty', async () => {
      // 1. Logs
      vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "err", jobName: "j", headSha: "s" });
      
      // 2. Diagnosis returns empty filePath (CyberSentinel case)
      vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Duplicate Test Module", filePath: "" });
      
      // 3. findClosestFile fails first time (empty path) then succeeds
      vi.mocked(services.findClosestFile)
        .mockResolvedValueOnce(null) // 1st call for empty path
        .mockResolvedValueOnce({ file: { name: 'test_dup.py', content: '', language: 'py' }, path: 'test_dup.py' }); // 2nd call after search
      
      // 4. Search finds a file using the Summary
      vi.mocked(services.toolCodeSearch).mockResolvedValue(["test_dup.py"]);
      
      // Rest of flow success
      vi.mocked(services.generateFix).mockResolvedValue("fixed");
      vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });
      vi.mocked(services.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: "ok" });
      vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "ok" });

      const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);
      
      expect(state.status).toBe('success');
      // Assert search was called with summary
      expect(services.toolCodeSearch).toHaveBeenCalledWith(expect.anything(), "Duplicate Test Module");
  });

  it('should fail after max iterations if tests do not pass', async () => {
      // 1. Logs & Diagnosis
      vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "err", jobName: "j", headSha: "s" });
      vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Broken", filePath: "f.py" });
      vi.mocked(services.findClosestFile).mockResolvedValue({ file: { name: 'f.py', content: '', language: 'py' }, path: 'f.py' });
      
      // 2. Fix generation always succeeds
      vi.mocked(services.generateFix).mockResolvedValue("fixed_code");
      vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });
      
      // 3. Judge passes the fix
      vi.mocked(services.judgeFix).mockResolvedValue({ passed: true, score: 8, reasoning: "looks ok" });
      
      // 4. Sandbox FAILS every time
      vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: false, logs: "Tests Failed" });

      const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

      expect(state.status).toBe('failed');
      expect(state.phase).toBe(AgentPhase.FAILURE);
      expect(services.runSandboxTest).toHaveBeenCalledTimes(3); // Assuming MAX_ITERATIONS is 3 in agent.ts
  });
});
