# Plan: File Path Hallucination Mitigation & Robust Discovery

This plan outlines the steps to implement a robust path validation and discovery mechanism to prevent agents from hallucinating file paths and getting stuck in loops.

## Phase 1: Utility Enhancement & Foundation [checkpoint: 028a866]

In this phase, we will enhance the core path detection utility to support validation and fuzzy matching.

- [x] Task: TDD - Implement path existence check in `utils/pathDetection.ts` 02d8a09
- [x] Task: TDD - Implement fuzzy filename matching in `utils/pathDetection.ts` 02d8a09
- [x] Task: Conductor - User Manual Verification 'Phase 1: Utility Enhancement & Foundation' (Protocol in workflow.md) 028a866

## Phase 2: Service Layer & Tool Integration [checkpoint: 2d7f76f]

In this phase, we will integrate the enhanced path detection into the tool layer and provide better feedback to agents.

- [x] Task: TDD - Update `read_file` tool to use `pathDetection` validation and return suggestions on failure dac0793
- [x] Task: TDD - Update `replace` tool to use `pathDetection` validation and return suggestions on failure dac0793
- [x] Task: Conductor - User Manual Verification 'Phase 2: Service Layer & Tool Integration' (Protocol in workflow.md) 2d7f76f

## Phase 3: Loop Detection & Automated Recovery

In this phase, we will update the `LoopDetector` to handle path-related failures and trigger automated recovery (discovery).

- [x] Task: TDD - Update `LoopDetector` to track repeated "No such file or directory" errors 7d91da8
- [x] Task: TDD - Implement automated `glob` search trigger upon path-related loop detection 7d91da8
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Loop Detection & Automated Recovery' (Protocol in workflow.md)

## Phase 4: Final Integration & Verification

In this phase, we will perform end-to-end verification and ensure the system behaves correctly under hallucination scenarios.

- [ ] Task: Integration Test - Simulate agent hallucination and verify automated recovery to correct path
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Final Integration & Verification' (Protocol in workflow.md)
