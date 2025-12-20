# Implementation Plan: Frontend Environment Stabilization

This plan outlines the steps to make the CI-Fixer agent more robust against environmental instability in frontend projects, specifically addressing dependency and tooling corruption.

## Phase 1: Environmental Error Detection
*Goal: Enable the agent to distinguish between code bugs and environment issues.*

- [x] Task: Update `errorClassification.ts` to include specific patterns for `patch-package` mismatches and `msw` initialization errors. a9b496f
- [x] Task: Implement a "Mass Failure Detector" that flags the environment as unstable if the percentage of failed tests exceeds a configurable threshold (e.g., >50%). a9b496f
- [x] Task: Write unit tests in `__tests__/unit/errorClassification.test.ts` to verify detection of these new environmental categories. a9b496f
- [ ] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Stabilization Service Implementation
*Goal: Create the tools necessary to repair the environment.*

- [ ] Task: Create `services/sandbox/EnvironmentService.ts` to manage environment-level commands.
- [ ] Task: Implement `refreshDependencies()` to run `pnpm install` and handle lockfile synchronization.
- [ ] Task: Implement `purgeEnvironment()` to remove `node_modules` and clear package manager caches.
- [ ] Task: Implement `repairPatches()` to attempt automatic regeneration of `patch-package` files.
- [ ] Task: Implement `killDanglingProcesses()` to cleanup orphaned test runners or servers.
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Workflow Integration (Verification Node)
*Goal: Integrate stabilization into the agent's decision-making loop.*

- [ ] Task: Modify the `verification` node in `agent/graph/nodes/verification.ts` to analyze test results for environmental flags.
- [ ] Task: Implement retry logic within the verification node that triggers stabilization before a second test attempt.
- [ ] Task: Ensure stabilization actions are logged separately from the primary fix trajectory.
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Integration Testing & Hardening
*Goal: Ensure end-to-end reliability.*

- [ ] Task: Create an integration test in `__tests__/integration/environment-recovery.test.ts` simulating a corrupted `node_modules` and verifying the agent heals it.
- [ ] Task: Verify that stabilization does not trigger on valid, fix-related test failures.
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
