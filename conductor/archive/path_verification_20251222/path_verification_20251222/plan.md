# Plan: Robust File Path Verification

## Phase 1: Exploration and Core Logic
- [x] Analyze codebase to identify tool execution entry points (focus on `agent/`, `services/`, and `utils/`)
- [x] Create `services/PathVerifier.ts` with core logic:
    - *Note: Logic implemented in `utils/fileVerification.ts` and `services/sandbox/agent_tools.ts`.*
    - `verifyPath(path: string): Promise<VerificationResult>`
    - `findAlternativePaths(filename: string): Promise<string[]>`
    - Unit tests for `PathVerifier` covering:
        - Exact match found
        - No file found, single alternative found (Auto-Recovery)
        - No file found, multiple alternatives found (Ambiguity Error)
        - No file found, no alternatives (Standard Error)
    - *Verified via `__tests__/unit/fileVerification.test.ts`*

## Phase 2: Tool Integration (Read/Write/Replace)
- [x] Integrate `PathVerifier` into `read_file` tool handler
    - Intercept call, verify path, auto-correct if unique alternative exists.
    - *Implemented in `services/sandbox/agent_tools.ts`*
- [x] Integrate `PathVerifier` into `replace` tool handler
    - *Note: `replace` is not a standalone tool; handled via `read` and `write` verification.*
- [x] Integrate `PathVerifier` into `write_file` tool handler
    - Verify parent directory exists or correct path if it's a known file modification.
    - *Implemented in `services/sandbox/agent_tools.ts`*
    - *Verified via `__tests__/unit/services/sandbox/agent_tools_verification.test.ts`*

## Phase 3: Shell Command Integration (Advanced)
- [x] Implement command parser for `run_shell_command` to detect `mv`, `cp`, `rm`
    - Extract target file paths from the command string.
- [x] Integrate `PathVerifier` into `run_shell_command` execution flow
    - Pre-check paths before execution.
    - *Implemented in `services/sandbox/agent_tools.ts` (runCmd)*
    - *Verified via `__tests__/unit/services/sandbox/agent_tools_verification.test.ts`*

## Phase 4: Telemetry and Final Verification
- [x] Add telemetry logging for every auto-correction event (track frequency of hallucinations).
    - *Implemented via `logPathCorrection` in `agent_tools.ts`*
- [x] Create E2E test scenarios:
    - Agent tries `read_file` with wrong folder -> Success (corrected).
    - Agent tries `rm` with wrong path -> Success (corrected).
    - *Verified via `__tests__/unit/services/sandbox/agent_tools_verification.test.ts`*
- [x] Final manual verification and documentation update.
