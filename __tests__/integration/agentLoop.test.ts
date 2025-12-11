
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
    runDevShellCommand: vi.fn(),
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
      filePath: "src/calc.py",
      fixAction: 'edit'
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
    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Duplicate Test Module", filePath: "", fixAction: 'edit' });

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
    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Broken", filePath: "f.py", fixAction: 'edit' });
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
    expect(services.runSandboxTest).toHaveBeenCalledTimes(5); // Assuming MAX_ITERATIONS is 5 in agent.ts
  });

  it('should execute command when fixAction is command', async () => {
    // 1. Logs & Diagnosis
    vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "err", jobName: "j", headSha: "s" });
    vi.mocked(services.diagnoseError).mockResolvedValue({
      summary: "Missing dependency",
      filePath: "",
      fixAction: 'command',
      suggestedCommand: "npm install foo"
    });

    // 2. Command Execution
    vi.mocked(services.runDevShellCommand).mockResolvedValue({
      exitCode: 0,
      output: "installed foo"
    });

    // 3. Sandbox Phase
    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "Tests Passed" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.runDevShellCommand).toHaveBeenCalledWith(expect.anything(), "npm install foo");
    // Should skip findClosestFile and generateFix
    expect(services.findClosestFile).not.toHaveBeenCalled();
    expect(services.generateFix).not.toHaveBeenCalled();
  });

  it('should retry when Judge rejects the fix', async () => {
    // 1. Logs & Diagnosis
    vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "err", jobName: "j", headSha: "s" });
    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Bug", filePath: "bug.ts", fixAction: 'edit' });
    vi.mocked(services.findClosestFile).mockResolvedValue({ file: { name: 'bug.ts', content: '', language: 'ts' }, path: 'bug.ts' });
    vi.mocked(services.generateFix).mockResolvedValue("fixed_code");
    vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });

    // 2. Judge Rejects first, then passes
    vi.mocked(services.judgeFix)
      .mockResolvedValueOnce({ passed: false, score: 2, reasoning: "Bad fix" })
      .mockResolvedValueOnce({ passed: true, score: 9, reasoning: "Good fix" });

    // 3. Sandbox
    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "ok" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.judgeFix).toHaveBeenCalledTimes(2);
    // Should re-diagnose or at least retry the loop
    expect(services.generateFix).toHaveBeenCalledTimes(2);
  });

  it('should handle runtime exceptions gracefully', async () => {
    // Force an error
    vi.mocked(services.getWorkflowLogs).mockRejectedValue(new Error("Network Error"));

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('failed');
    expect(state.phase).toBe(AgentPhase.FAILURE);
    expect(state.message).toBe("Network Error");
  });

  it('should try fallback log strategies when "No failed job found"', async () => {
    // 1. Initial strategy fails
    vi.mocked(services.getWorkflowLogs)
      .mockResolvedValueOnce({ logText: "No failed job found", headSha: "", jobName: "job1" }) // standard
      .mockResolvedValueOnce({ logText: "No failed job found", headSha: "", jobName: "job1" }) // extended
      .mockResolvedValueOnce({ logText: "Error FoundHere", headSha: "sha", jobName: "job1" }); // any_error

    // Then proceed normally
    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Err", filePath: "f.ts", fixAction: 'edit' });
    vi.mocked(services.findClosestFile).mockResolvedValue({ file: { name: 'f.ts', content: '', language: 'ts' }, path: 'f.ts' });
    vi.mocked(services.generateFix).mockResolvedValue("code");
    vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });
    vi.mocked(services.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: "ok" });
    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "ok" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.getWorkflowLogs).toHaveBeenCalledTimes(3);
    // It should try multiple strategies
  });

  it('should retry when command execution fails', async () => {
    vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "err", jobName: "j", headSha: "s" });
    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Cmd Error", filePath: "", fixAction: 'command', suggestedCommand: "ls" });

    // 1. Fail, 2. Success
    vi.mocked(services.runDevShellCommand)
      .mockResolvedValueOnce({ exitCode: 1, output: "Permission denied" })
      .mockResolvedValueOnce({ exitCode: 0, output: "success" });

    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "ok" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.runDevShellCommand).toHaveBeenCalledTimes(2);
  });

  it('should fallback to CREATE file mode when file is missing and error implies missing file', async () => {
    vi.mocked(services.getWorkflowLogs).mockResolvedValue({ logText: "err", jobName: "j", headSha: "s" });
    // Error message implies missing file
    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Error: No such file or directory: 'new.py'", filePath: "new.py", fixAction: 'edit' });

    // File NOT found
    vi.mocked(services.findClosestFile).mockResolvedValue(null);
    vi.mocked(services.toolCodeSearch).mockResolvedValue([]); // No search results

    // Should create file object
    vi.mocked(services.generateFix).mockResolvedValue("print('hello')");
    vi.mocked(services.toolLintCheck).mockResolvedValue({ valid: true });
    vi.mocked(services.judgeFix).mockResolvedValue({ passed: true, score: 10, reasoning: "ok" });
    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "ok" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    // Check that fileReservations includes the new file
    expect(updateStateCallback).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fileReservations: ["new.py"] }));
  });
});
