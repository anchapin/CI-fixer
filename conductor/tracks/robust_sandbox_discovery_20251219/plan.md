# Implementation Plan: Robust Sandbox File Discovery

This plan details the steps to enhance the ci-fixer agent's file discovery and validation logic within the sandbox environment to prevent erroneous edits due to missing file references.

## Phase 1: Enhanced Search & Git History Integration [checkpoint: edbd621]
*Goal: Implement deep search and git-aware file tracking.*

- [x] Task: Write failing tests for `FileDiscoveryService` simulating missing files and renames in `__tests__/unit/file-discovery.test.ts`. 7ad419c
- [x] Task: Implement `recursiveSearch` and `fuzzySearch` logic in a new `services/sandbox/FileDiscoveryService.ts`. 7ad419c
- [x] Task: Integrate `git log` analysis into `FileDiscoveryService.ts` to detect file renames or deletions. 7ad419c
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md) edbd621

## Phase 2: Candidate Verification & Build Validation
*Goal: Ensure discovered candidates are valid for the target build step.*

- [~] Task: Write failing tests for candidate verification (content analysis and dry-run) in `__tests__/unit/file-verification.test.ts`.
- [ ] Task: Implement content-based verification (e.g., checking if a requirements file contains dependency declarations).
- [ ] Task: Implement "dry-run" build validation logic to test candidates in the sandbox before proposing changes.
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Safe Fallback & Placeholder Logic
*Goal: Implement intelligent fallback strategies for definitively missing files.*

- [ ] Task: Write failing tests for placeholder generation and stale reference detection in `__tests__/unit/file-fallback.test.ts`.
- [ ] Task: Implement heuristic-based placeholder generation (e.g., creating empty requirements files).
- [ ] Task: Implement logic to identify and propose removal of stale references in config files (e.g., Dockerfile).
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Integration into Agent Flow
*Goal: Wire the new discovery and validation services into the main agent loop.*

- [ ] Task: Write integration tests in `__tests__/integration/sandbox-discovery.test.ts` showing the agent correctly handling a renamed requirements file.
- [ ] Task: Update the main agent logic (likely in `agent.ts` or `services/orchestration/`) to use `FileDiscoveryService` when a file lookup fails.
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
