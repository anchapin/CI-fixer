# Plan: Environment Context Confusion (Bun vs. Node)

## Phase 1: Environment Detection & Diagnostics
- [x] Task: Implement `BunDetector` utility to check for `bun.lockb`, `bunfig.toml`, and `bun:` imports. [6f5d1cd]
- [x] Task: Create a diagnostic helper to identify "Bun-specific" error patterns in command output (e.g., `Cannot bundle built-in module "bun:test"`). [079159a]
- [x] Task: Unit tests for `BunDetector` and error pattern matching. [079159a]
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Environment Detection & Diagnostics' (Protocol in workflow.md)

## Phase 2: Sandbox & Container Provisioning
- [ ] Task: Update Dockerfile/Container provisioning scripts to include Bun installation.
- [ ] Task: Modify the environment setup logic to ensure Bun is available if `BunDetector` returns true or if a Bun-switch is likely needed.
- [ ] Task: Verify Bun availability within the sandbox environment.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Sandbox & Container Provisioning' (Protocol in workflow.md)

## Phase 3: Adaptive Execution Strategy
- [ ] Task: Implement the "Context-Sensitive" switching logic in the command execution service.
- [ ] Task: Update the test execution service to switch from `vitest` to `bun test` upon detecting Bun-specific failure signatures.
- [ ] Task: Update dependency installation logic to prefer `bun install` when in a Bun context.
- [ ] Task: Integration tests simulating a "hybrid" project failure and successful Bun recovery.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Adaptive Execution Strategy' (Protocol in workflow.md)

## Phase 4: Final Verification
- [ ] Task: Run full regression suite to ensure Node-only projects are unaffected.
- [ ] Task: Verify the "hybrid" scenario (Bun imports + Vitest config) correctly switches to Bun execution.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Final Verification' (Protocol in workflow.md)
