# Plan: Multi-Layer Agent Reliability Enhancement

This plan implements three synergistic improvements to address critical production failures identified in ci_fixer_debug_2025-12-29T15-43-35-609Z.json.

**Decision Reference:** dec-cc3a5d60 (2025-12-29)
**Total Estimated Effort:** 5-8 hours

## Phase 1: Path Resolution Enhancement (2-3 hours)
- [x] Task: Add absolute path conversion utility in `agent/worker.ts` e6a7c86
  - Create function `toAbsolutePath(path, workingDir)` that converts relative paths to absolute
  - Integrate with existing `findClosestFile` to get absolute paths
  - Add validation step before file operations
- [x] Task: Modify file operation calls in worker to use absolute paths ddedc78
  - Update all `findClosestFile` calls to store absolute paths
  - Update `validateFileExists` to accept absolute paths
  - Add path verification before `writeFile` and sandbox file operations
- [x] Task: Write unit tests for path resolution logic e6a7c86
  - Test absolute path conversion from relative paths
  - Test path validation with existing/missing files
  - Test integration with `findClosestFile` and `validateFileExists`
- [x] Task: Write integration test for "agent lost" scenario decac03
  - Simulate scenario where agent attempts operation on non-absolute path
  - Verify path resolution catches the issue and provides clear error
- [ ] Task: Verify coverage >80% for path resolution code
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Path Resolution Enhancement'

## Phase 2: Reproduction-First Workflow (1-2 hours)
- [ ] Task: Add reproduction command requirement check in graph coordinator
  - In `agent/graph/coordinator.ts`, check `diagnosis.reproductionCommand` before allowing transition to execution node
  - If missing, log error and halt with clear message
  - Add state flag `reproductionRequired` to GraphState
- [ ] Task: Enhance verification node to enforce reproduction requirement
  - In `agent/graph/nodes/verification.ts`, fail early if no reproduction command
  - Provide clear error message indicating reproduction command is required
  - Suggest running ReproductionInferenceService if command is missing
- [ ] Task: Write unit tests for reproduction requirement enforcement
  - Test coordinator halts when reproduction command is missing
  - Test verification node rejects fixes without reproduction command
  - Test successful flow when reproduction command is present
- [ ] Task: Write integration test for verification gap scenario
  - Simulate scenario where agent tries to fix without reproduction command
  - Verify agent halts and requests human intervention
- [ ] Task: Verify coverage >80% for reproduction enforcement code
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Reproduction-First Workflow'

## Phase 3: Strategy Loop Detection (2-3 hours)
- [ ] Task: Add divergence detection to graph coordinator
  - Enhance existing `detectConvergence` call in `coordinator.ts` (line 163)
  - Add logic to detect `isDiverging` when complexity increases over iterations
  - Track complexity trend: [10, 12, 14, 16] = diverging
- [ ] Task: Implement halt mechanism for divergent complexity
  - When `isDiverging` AND `problemComplexity > 15` for >2 iterations
  - Set state status to 'failed' with failureReason indicating strategy loop
  - Add clear log message about divergence and suggestion for human intervention
- [ ] Task: Add human intervention trigger with context
  - When halting, provide context about the loop in `activeLog`
  - Include: complexity history, attempted fixes, suggestion for alternative approach
  - Mark state with special status code for UI to display help request
- [ ] Task: Write unit tests for loop detection logic
  - Test divergence detection with various complexity sequences
  - Test halt mechanism triggers at correct threshold
  - Test human intervention context is properly formatted
- [ ] Task: Write integration test for strategy loop scenario
  - Simulate scenario from production: complexity 16.8, 9 attempts, no progress
  - Verify agent halts and provides helpful context
- [ ] Task: Verify coverage >80% for loop detection code
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Strategy Loop Detection'

## Phase 4: Integration & Final Verification (1 hour)
- [ ] Task: Run full test suite and verify no regressions
  - Command: `CI=true npm test`
  - Ensure all existing tests still pass
- [ ] Task: Run coverage report and verify >80% overall
  - Command: `npm run test:coverage`
  - Verify coverage thresholds met
- [ ] Task: Create end-to-end test demonstrating all three layers
  - Test scenario where agent would have failed without enhancements
  - Verify path resolution prevents "agent lost"
  - Verify reproduction requirement prevents "coding blind"
  - Verify loop detection prevents resource exhaustion
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Integration & Final Verification'
- [ ] Task: Create checkpoint commit with message: `feat(agent): implement multi-layer agent reliability enhancement (Phase 1-4 complete)`
