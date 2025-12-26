# Plan: File System State Mismatch Fix

## Phase 1: Enhanced Path Analysis & Search Utilities
- [x] Task: Create `utils/pathDetection.ts` with regex-based heuristics to extract all potential file paths from a shell command string. (3dcbd64)
- [ ] Task: Enhance `utils/fileVerification.ts` to include Levenshtein-based similarity and `git ls-files` awareness.
- [ ] Task: Write unit tests for the new path detection and fuzzy search logic.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Enhanced Path Analysis & Search Utilities' (Protocol in workflow.md)

## Phase 2: Tool Wrapper Integration
- [ ] Task: Update `runCmd` in `services/sandbox/agent_tools.ts` to use the new path detection logic for *all* commands.
- [ ] Task: Update `runCmd` to verify detected paths and attempt recovery using the enhanced fuzzy search.
- [ ] Task: Improve feedback in `runCmd` when a mismatch is corrected or when multiple candidates are found.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Tool Wrapper Integration' (Protocol in workflow.md)

## Phase 3: Final Verification
- [ ] Task: Write integration tests to simulate "phantom file" scenarios (e.g., trying to `rm` a file that moved).
- [ ] Task: Verify that performance remains acceptable.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Final Verification' (Protocol in workflow.md)
