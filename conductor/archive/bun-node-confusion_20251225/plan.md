# Plan: Environment Context Confusion (Bun vs. Node)

## Phase 1: Environment Detection & Diagnostics [checkpoint: 829f07f]
- [x] Task: Implement `BunDetector` utility to check for `bun.lockb`, `bunfig.toml`, and `bun:` imports. [6f5d1cd]
- [x] Task: Create a diagnostic helper to identify "Bun-specific" error patterns in command output (e.g., `Cannot bundle built-in module "bun:test"`). [079159a]
- [x] Task: Unit tests for `BunDetector` and error pattern matching. [079159a]
- [x] Task: Conductor - User Manual Verification 'Phase 1: Environment Detection & Diagnostics' (Protocol in workflow.md)

## Phase 2: Sandbox & Container Provisioning [checkpoint: 925bd90]
- [x] Task: Update Dockerfile/Container provisioning scripts to include Bun installation. [7aa2e7d]
- [x] Task: Modify the environment setup logic to ensure Bun is available if `BunDetector` returns true or if a Bun-switch is likely needed. [7aa2e7d]
- [x] Task: Verify Bun availability within the sandbox environment. [7aa2e7d]
- [x] Task: Conductor - User Manual Verification 'Phase 2: Sandbox & Container Provisioning' (Protocol in workflow.md)

## Phase 3: Adaptive Execution Strategy [checkpoint: 4d05488]
- [x] Task: Implement the "Context-Sensitive" switching logic in the command execution service. [7faec97]
- [x] Task: Update the test execution service to switch from `vitest` to `bun test` upon detecting Bun-specific failure signatures. [7faec97]
- [x] Task: Update dependency installation logic to prefer `bun install` when in a Bun context. [7faec97]
- [x] Task: Integration tests simulating a "hybrid" project failure and successful Bun recovery. [7faec97]
- [x] Task: Conductor - User Manual Verification 'Phase 3: Adaptive Execution Strategy' (Protocol in workflow.md)

## Phase 4: Final Verification [checkpoint: 7faec97]
- [x] Task: Run full regression suite to ensure Node-only projects are unaffected. [7faec97]
- [x] Task: Verify the "hybrid" scenario (Bun imports + Vitest config) correctly switches to Bun execution. [7faec97]
- [x] Task: Conductor - User Manual Verification 'Phase 4: Final Verification' (Protocol in workflow.md)
