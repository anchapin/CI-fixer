
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIndependentAgentLoop } from '../../agent';
import { AgentPhase, AppConfig, RunGroup, WorkflowRun } from '../../types';

// Mock DB
vi.mock('../../db/client', () => ({
  db: {
    errorFact: { findFirst: vi.fn(), create: vi.fn() },
    fileModification: { create: vi.fn() }
  }
}));

// Mock Services Synchronously with Factory Logic
vi.mock('../../services', () => {
  return {
    getWorkflowLogs: vi.fn().mockImplementation(async () => {
      console.log("[FACTORY] getWorkflowLogs called");
      return { logText: "Error: Division by zero", jobName: "test", headSha: "abc" };
    }),
    toolScanDependencies: vi.fn().mockResolvedValue("No dependencies found"),
    toolCodeSearch: vi.fn().mockResolvedValue([]),
    diagnoseError: vi.fn().mockImplementation(async () => {
      console.log("[FACTORY] diagnoseError called");
      return { summary: "Diagnosis", filePath: "f.py", fixAction: 'edit' };
    }),
    generateDetailedPlan: vi.fn(),
    judgeDetailedPlan: vi.fn(),
    findClosestFile: vi.fn().mockResolvedValue({ file: { name: 'f.py', content: '', language: 'py' }, path: 'f.py' }),
    toolWebSearch: vi.fn().mockResolvedValue(""),
    generateFix: vi.fn().mockResolvedValue("fixed"),
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: "ok" }),
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "ok" }),
    runDevShellCommand: vi.fn(),
    prepareSandbox: vi.fn().mockResolvedValue({
      getId: () => 'mock-sandbox',
      init: vi.fn(),
      teardown: vi.fn(),
      runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      writeFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue(''),
      getWorkDir: () => '/mock'
    }),
    generateRepoSummary: vi.fn().mockResolvedValue("Summary"),
  };
});

// Mock context compiler (handle both resolution paths)
vi.mock('../../services/context-compiler', () => ({
  getCachedRepoContext: vi.fn().mockResolvedValue("Mock Repo Context TS"),
  filterLogs: vi.fn(),
  summarizeLogs: vi.fn(),
}));

vi.mock('../../services/context-compiler.js', () => ({
  getCachedRepoContext: vi.fn().mockResolvedValue("Mock Repo Context JS"),
  filterLogs: vi.fn(),
  summarizeLogs: vi.fn(),
}));

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

  const updateStateCallback = vi.fn((id, state) => console.log(`[STATE UPDATE] ${state.phase} - ${state.status}`));
  const logCallback = vi.fn((level, content) => console.log(`[${level}] ${content}`));

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all service mocks to default behavior to prevent test pollution
    vi.mocked(services.getWorkflowLogs).mockReset().mockResolvedValue({ logText: "Error: Division by zero", jobName: "test", headSha: "abc" });
    vi.mocked(services.diagnoseError).mockReset().mockResolvedValue({ summary: "Diagnosis", filePath: "f.py", fixAction: 'edit' });
    vi.mocked(services.findClosestFile).mockReset().mockResolvedValue({ file: { name: 'f.py', content: '', language: 'py' }, path: 'f.py' });
    vi.mocked(services.generateFix).mockReset().mockResolvedValue("fixed");
    vi.mocked(services.toolLintCheck).mockReset().mockResolvedValue({ valid: true });
    vi.mocked(services.judgeFix).mockReset().mockImplementation(async () => {
      console.log("[DEBUG] Factory judgeFix called");
      return { passed: true, score: 10, reasoning: "ok" };
    });
    vi.mocked(services.runSandboxTest).mockReset().mockResolvedValue({ passed: true, logs: "ok" });
    vi.mocked(services.toolCodeSearch).mockReset().mockResolvedValue([]);
    vi.mocked(services.toolWebSearch).mockReset().mockResolvedValue("");
    vi.mocked(services.runDevShellCommand).mockReset().mockResolvedValue({ exitCode: 0, output: "ok" });
    vi.mocked(services.toolScanDependencies).mockReset().mockResolvedValue("No dependencies");
    vi.mocked(services.generateRepoSummary).mockReset().mockResolvedValue("Summary");

    vi.mocked(services.prepareSandbox).mockReset().mockResolvedValue({
      getId: () => 'mock-sandbox',
      init: vi.fn(),
      teardown: vi.fn(),
      runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      writeFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue(''),
      getWorkDir: () => '/mock'
    } as any);

    // Context Compiler Mocks are global but we mocked them resolving static string
  });

  it('should successfully fix a bug in one iteration with File Reservation Protocol', async () => {
    // 1. Understand Phase Mocks (Override default factory mocks if needed, but defaults are good for success path)

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
      expect.objectContaining({ fileReservations: ["f.py"] }) // Factory default is f.py
    );
  });

  it('should fallback to summary search if diagnosis filepath is empty', async () => {
    // Override Diagnosis for this test
    vi.mocked(services.diagnoseError).mockResolvedValueOnce({ summary: "Duplicate Test Module", filePath: "", fixAction: 'edit' });
    vi.mocked(services.findClosestFile)
      .mockResolvedValueOnce(null) // 1st call for empty path
      .mockResolvedValueOnce({ file: { name: 'test_dup.py', content: '', language: 'py' }, path: 'test_dup.py' });

    vi.mocked(services.toolCodeSearch).mockResolvedValueOnce(["test_dup.py"]);

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.toolCodeSearch).toHaveBeenCalledWith(expect.anything(), "Duplicate Test Module", expect.anything());
  });

  it('should fail after max iterations if tests do not pass', async () => {
    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: false, logs: "Tests Failed" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('failed');
    expect(state.phase).toBe(AgentPhase.FAILURE);
    expect(services.runSandboxTest).toHaveBeenCalledTimes(5);
  });

  it('should execute command when fixAction is command', async () => {
    // We need to spy on sandbox.runCommand
    const mockRunCommand = vi.fn().mockResolvedValue({ stdout: 'installed foo', stderr: '', exitCode: 0 });

    // Override prepareSandbox to return our spy
    vi.mocked(services.prepareSandbox).mockResolvedValueOnce({
      getId: () => 'mock-sandbox',
      init: vi.fn(),
      teardown: vi.fn(),
      runCommand: mockRunCommand,
      writeFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue(''),
      getWorkDir: () => '/mock'
    } as any);

    vi.mocked(services.diagnoseError).mockResolvedValue({
      summary: "Missing dependency",
      filePath: "",
      fixAction: 'command',
      suggestedCommand: "npm install foo"
    });

    vi.mocked(services.runSandboxTest).mockResolvedValue({ passed: true, logs: "Tests Passed" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(mockRunCommand).toHaveBeenCalledWith("npm install foo");

    // Should skip findClosestFile and generateFix
    expect(services.findClosestFile).not.toHaveBeenCalled();
    expect(services.generateFix).not.toHaveBeenCalled();
  });

  it('should retry when Judge rejects the fix', async () => {
    vi.mocked(services.judgeFix)
      .mockResolvedValueOnce({ passed: false, score: 2, reasoning: "Bad fix" })
      .mockResolvedValueOnce({ passed: true, score: 9, reasoning: "Good fix" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.judgeFix).toHaveBeenCalledTimes(2);
    expect(services.generateFix).toHaveBeenCalledTimes(2);
  });

  it('should handle runtime exceptions gracefully', async () => {
    vi.mocked(services.getWorkflowLogs).mockRejectedValueOnce(new Error("Network Error"));

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('failed');
    expect(state.phase).toBe(AgentPhase.FAILURE);
    expect(state.message).toBe("Network Error");
  });

  it('should try fallback log strategies when "No failed job found"', async () => {
    vi.mocked(services.getWorkflowLogs)
      .mockResolvedValueOnce({ logText: "No failed job found", headSha: "", jobName: "job1" })
      .mockResolvedValueOnce({ logText: "No failed job found", headSha: "", jobName: "job1" })
      .mockResolvedValueOnce({ logText: "Error FoundHere", headSha: "sha", jobName: "job1" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(services.getWorkflowLogs).toHaveBeenCalledTimes(3);
  });

  it('should retry when command execution fails', async () => {
    const mockRunCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: 'Permission denied', stderr: '', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: 'success', stderr: '', exitCode: 0 });

    vi.mocked(services.prepareSandbox).mockResolvedValueOnce({
      getId: () => 'mock-sandbox',
      init: vi.fn(),
      teardown: vi.fn(),
      runCommand: mockRunCommand,
      writeFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue(''),
      getWorkDir: () => '/mock'
    } as any);

    vi.mocked(services.diagnoseError).mockResolvedValue({ summary: "Cmd Error", filePath: "", fixAction: 'command', suggestedCommand: "ls" });

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
  });

  it('should fallback to CREATE file mode when file is missing and error implies missing file', async () => {
    vi.mocked(services.diagnoseError).mockResolvedValueOnce({ summary: "Error: No such file or directory: 'new.py'", filePath: "new.py", fixAction: 'edit' });
    vi.mocked(services.findClosestFile).mockResolvedValueOnce(null);
    vi.mocked(services.toolCodeSearch).mockResolvedValueOnce([]);

    vi.mocked(services.generateFix).mockResolvedValueOnce("print('hello')");

    const state = await runIndependentAgentLoop(mockConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(updateStateCallback).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fileReservations: ["new.py"] }));
  });

  it('should verify fix using reproduction command if available (TDR)', async () => {
    vi.mocked(services.diagnoseError).mockResolvedValueOnce({
      summary: "Bug",
      filePath: "bug.ts",
      fixAction: 'edit',
      reproductionCommand: "npm test bug.ts"
    });
    vi.mocked(services.findClosestFile).mockResolvedValueOnce({ file: { name: 'bug.ts', content: '', language: 'ts' }, path: 'bug.ts' });

    // Command Mocks: 1. Repro (fail), 2. Verify (pass)
    // NOTE: Factory default runDevShellCommand returns success (0). We need to override it? 
    // Wait, factory for runDevShellCommand is vi.fn() which returns undefined/void unless mocked.
    // In factory above I defined it as vi.fn() only (no mockResolvedValue).
    // So I MUST mock it in every test that uses it?
    // In "should execute command when fixAction is command" I mocked it.
    // In "should successfully fix a bug..." I rely on Sandbox.runCommand default mock?
    // Worker only calls runDevShellCommand if fixAction is command OR for diagnose (via repo context).
    // Repo Context uses `runDevShellCommand`. 
    // In factory, `generateRepoSummary` is mocked, so regular `runDevShellCommand` is not called for context.

    // For TDR, worker calls `sandbox.runCommand` directly.
    // The factory `prepareSandbox` mocks `runCommand` to return { exitCode: 0 }.

    // So for TDR reproduction logic:
    // 1. Initial Repro: expect exitCode 0? No, `failure reproduced` means command failed (exit != 0)?
    // Usually repro command "npm test bug" fails if bug present.
    // Logic: if exitCode == 0, log WARN "Reproduction passed unexpectedly".
    // If exitCode != 0, log SUCCESS "Failure Reproduced".

    // We want repro to FAIL first (exit != 0).
    // Then Verify to PASS (exit == 0).

    // We need to access the spy on the sandbox instance.
    // Since prepareSandbox returns a mock object, we can't easily spy on it unless we save reference or re-mock prepareSandbox.

    const mockRunCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: 'fail', stderr: '', exitCode: 1 }) // Repro
      .mockResolvedValueOnce({ stdout: 'pass', stderr: '', exitCode: 0 }); // Verify

    vi.mocked(services.prepareSandbox).mockResolvedValueOnce({
      getId: () => 'mock-sandbox',
      init: vi.fn(),
      teardown: vi.fn(),
      runCommand: mockRunCommand,
      writeFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue(''),
      getWorkDir: () => '/mock'
    } as any);

    const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'key' };
    const state = await runIndependentAgentLoop(e2bConfig, mockGroup, "", updateStateCallback, logCallback);

    expect(state.status).toBe('success');
    expect(mockRunCommand).toHaveBeenCalledWith(expect.stringContaining("npm test bug.ts"));
  });

  it('should cleanup E2B sandbox on exit', async () => {
    const mockKill = vi.fn();
    vi.mocked(services.prepareSandbox).mockResolvedValueOnce({
      getId: () => 's1',
      init: vi.fn(),
      teardown: mockKill, // In worker.ts it calls teardown() which logs? No, supervisor calls teardown.
      // But supervisor calls sandbox.teardown().
      runCommand: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      getWorkDir: () => '/'
    } as any);

    vi.mocked(services.getWorkflowLogs).mockRejectedValueOnce(new Error("Fail"));

    const e2bConfig: AppConfig = { ...mockConfig, devEnv: 'e2b', e2bApiKey: 'key' };
    try {
      await runIndependentAgentLoop(e2bConfig, mockGroup, "", updateStateCallback, logCallback);
    } catch { }

    expect(mockKill).toHaveBeenCalled();
  });
});
