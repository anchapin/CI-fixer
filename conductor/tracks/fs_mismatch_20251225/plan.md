# Plan: File System State Mismatch Fix

## Phase 1: Enhanced Path Analysis & Search Utilities [checkpoint: 80f02c7]
- [x] Task: Create `utils/pathDetection.ts` with regex-based heuristics to extract all potential file paths from a shell command string. (3dcbd64)
- [x] Task: Enhance `utils/fileVerification.ts` to include Levenshtein-based similarity and `git ls-files` awareness. (e1ddf75)
- [x] Task: Write unit tests for the new path detection and fuzzy search logic. (3dcbd64, e1ddf75)
- [x] Task: Conductor - User Manual Verification 'Phase 1: Enhanced Path Analysis & Search Utilities' (Protocol in workflow.md) (80f02c7)

## Phase 2: Tool Wrapper Integration [checkpoint: ce77345]
- [x] Task: Update `runCmd` in `services/sandbox/agent_tools.ts` to use the new path detection logic for *all* commands. (0606ba6)
- [x] Task: Integrate path verification and correction into `readFile` and `writeFile` wrappers in `agent_tools.ts`. (Already partially done, verified in Phase 2)
- [x] Task: Add telemetry logging for every path correction event. (Verified in Phase 2)
- [x] Task: Update integration tests to verify path correction in tool calls. (0606ba6)
- [x] Task: Conductor - User Manual Verification 'Phase 2: Tool Wrapper Integration' (Protocol in workflow.md) (ce77345)

## Phase 3: Final Verification
- [ ] Task: Write integration tests to simulate "phantom file" scenarios (e.g., trying to `rm` a file that moved).
- [ ] Task: Verify that performance remains acceptable.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Final Verification' (Protocol in workflow.md)
