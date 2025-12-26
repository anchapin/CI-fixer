import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoopDetector } from '../../services/LoopDetector';
import { readFile } from '../../services/sandbox/agent_tools';
import { validatePath } from '../../utils/pathDetection';

vi.mock('../../utils/pathDetection', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    validatePath: vi.fn(),
  };
});
vi.mock('fs');

describe('Automated Recovery Integration Test', () => {
  let loopDetector: LoopDetector;

  beforeEach(() => {
    loopDetector = new LoopDetector();
    vi.resetAllMocks();
  });

  it('should trigger glob search after repeated path hallucinations', async () => {
    // 1. Simulate first failed read (hallucination)
    vi.mocked(validatePath).mockReturnValue({
        valid: false,
        exists: false,
        absolutePath: '/mock/path/hallucination.ts',
        suggestions: []
    });
    await readFile('hallucination.ts');
    loopDetector.recordHallucination('hallucination.ts');

    // 2. Simulate second failed read (hallucination)
    await readFile('hallucination.ts');
    loopDetector.recordHallucination('hallucination.ts');
    
    // 3. Verify that the loop detector now suggests a strategy shift
    expect(loopDetector.shouldTriggerStrategyShift('hallucination.ts')).toBe(true);

    // 4. Verify that the recovery command is a glob search
    const recoveryCommand = loopDetector.triggerAutomatedRecovery();
    expect(recoveryCommand).toContain('glob');
    expect(recoveryCommand).toContain('hallucination.ts');
  });
});
