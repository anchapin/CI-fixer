# Plan: Robust File Path Verification

## Phase 1: Infrastructure & Core Logic [checkpoint: add01dd]
- [x] Task: Create `utils/fileVerification.ts` with core search and verification logic. (5e3ebdf)
- [x] Task: Write unit tests for `fileVerification.ts` covering unique match, multiple matches, and no matches. (5e3ebdf)
- [x] Task: Implement `findUniqueFile(filename: string, rootDir: string)` using `glob` or similar, respecting `.gitignore`. (5e3ebdf)
- [x] Task: Conductor - User Manual Verification 'Phase 1: Infrastructure & Core Logic' (Protocol in workflow.md) (add01dd)

## Phase 2: Tool Integration
- [x] Task: Integrate verification into `services/action-library.ts` (or relevant tool handler) for `read_file`. (5b07c12)
- [ ] Task: Integrate verification into `services/action-library.ts` for `replace` and `write_file`.
- [ ] Task: Update `run_shell_command` handler to intercept `mv`, `cp`, and `rm` for path verification.
- [ ] Task: Write integration tests for each tool to ensure auto-correction and error reporting work as specified.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Tool Integration' (Protocol in workflow.md)

## Phase 3: Telemetry & Refinement
- [ ] Task: Add logging/telemetry to track when a path is automatically corrected.
- [ ] Task: Refactor for performance (ensure searches are only triggered on failure).
- [ ] Task: Verify overall system behavior with a realistic "hallucination" scenario in an integration test.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Telemetry & Refinement' (Protocol in workflow.md)
