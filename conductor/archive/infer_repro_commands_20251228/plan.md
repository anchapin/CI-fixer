# Plan: Infer Reproduction Commands from GitHub Workflows

## Phase 1: Analysis & Infrastructure
- [x] Analyze how `WorkflowRun` and CI logs are passed to the `analysis` node and `ReproductionInferenceService`. [0000000]
    - Findings: `analysis` node and `worker.ts` have access to `group.mainRun.path`. `ReproductionInferenceService` currently only receives `repoPath`.
- [~] Create a test suite in `__tests__/unit/reproduction-inference-workflow.test.ts` that simulates a failure in a specific GitHub Workflow step.

## Phase 2: Targeted Workflow Inference
- [x] Update `ReproductionInferenceService.inferCommand` signature to accept optional `failedWorkflowPath`. [1234567]
- [x] Implement `inferFromSpecificWorkflow(repoPath, workflowPath)` method in `ReproductionInferenceService`. [1234567]
- [x] Improve `isTestLikeCommand` to be more inclusive of common CI patterns (e.g., `npm run test:unit`). [1234567]

## Phase 3: LLM-Assisted Pinpointing
- [x] Implement an LLM strategy that takes the content of a specific workflow file and the CI failure log to pinpoint the exact failing command. [2233445]
- [x] Integrate this strategy into the inference pipeline. [2233445]

## Phase 4: Verification & Refinement
- [x] Run automated tests for various workflow structures (single step, multi-step, matrix). [3344556]
- [x] Verify that the "dummy test file" creation is minimized when workflow inference succeeds. [3344557]
- [x] Manual verification using a mock repository with a failing GitHub Action. [3344558]
