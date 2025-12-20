# Implementation Plan: Robust Sandbox File Discovery

This plan details the steps to enhance the ci-fixer agent's file discovery and validation logic within the sandbox environment to prevent erroneous edits due to missing file references.

## Phase 1: Enhanced Search & Git History Integration [checkpoint: edbd621]
*Goal: Implement deep search and git-aware file tracking.*

- [x] Task: Write failing tests for `FileDiscoveryService` simulating missing files and renames in `__tests__/unit/file-discovery.test.ts`. 7ad419c
- [x] Task: Implement `recursiveSearch` and `fuzzySearch` logic in a new `services/sandbox/FileDiscoveryService.ts`. 7ad419c
- [x] Task: Integrate `git log` analysis into `FileDiscoveryService.ts` to detect file renames or deletions. 7ad419c
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md) edbd621

## Phase 2: Candidate Verification & Build Validation [checkpoint: 97ff7b3]
*Goal: Ensure discovered candidates are valid for the target build step.*

- [x] Task: Write failing tests for candidate verification (content analysis and dry-run) in `__tests__/unit/file-verification.test.ts`. 97ff7b3
- [x] Task: Implement content-based verification (e.g., checking if a requirements file contains dependency declarations). 97ff7b3
- [x] Task: Implement "dry-run" build validation logic to test candidates in the sandbox before proposing changes). 97ff7b3
- [x] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md) 97ff7b3

## Phase 3: Safe Fallback & Placeholder Logic [checkpoint: 1354daf]
*Goal: Implement intelligent fallback strategies for definitively missing files.*

- [x] Task: Write failing tests for placeholder generation and stale reference detection in `__tests__/unit/file-fallback.test.ts`. 1354daf
- [x] Task: Implement heuristic-based placeholder generation (e.g., creating empty requirements files). 1354daf
- [x] Task: Implement logic to identify and propose removal of stale references in config files (e.g., Dockerfile). 1354daf
- [x] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md) 1354daf

## Phase 4: Integration into Agent Flow [checkpoint: 2a146aa]
- [x] Task: Write integration tests in `__tests__/integration/sandbox-discovery.test.ts` showing the agent correctly handling a renamed requirements file. 658e6c0
- [x] Task: Update the main agent logic (likely in `agent.ts` or `services/orchestration/`) to use `FileDiscoveryService` when a file lookup fails. 658e6c0
- [x] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md) 2a146aa
