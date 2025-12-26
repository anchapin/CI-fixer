# Plan: Robust Reproduction Command Inference

This plan implements a multi-layered service to infer `reproductionCommand` when it's missing from agent output, ensuring verification can always proceed.

## Phase 1: Core Service & Workflow Analysis [checkpoint: 556b557]
- [x] Task: Create `ReproductionInferenceService` skeleton and types in `services/reproduction-inference.ts` (8af714e)
- [x] Task: Implement Workflow Parser to extract run commands from `.github/workflows/*.yml` (8af714e)
- [x] Task: Add logic to filter out non-test steps (e.g., checkout, setup-node) from workflow commands (8af714e)
- [x] Task: Write unit tests for Workflow Analysis strategy (8af714e)
- [x] Task: Conductor - User Manual Verification 'Phase 1: Core Service & Workflow Analysis' (Protocol in workflow.md) (556b557)

## Phase 2: Signature & Build Tool Detection
- [ ] Task: Implement File Signature Detection (Node/Bun, Python, Go, Rust)
- [ ] Task: Implement Build Tool Inspection (Makefile, Gradle, Maven, Rake)
- [ ] Task: Add a priority-based dispatcher to execute strategies in order (Workflow > Signature > Build Tool)
- [ ] Task: Write unit tests for Signature and Build Tool detection
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Signature & Build Tool Detection' (Protocol in workflow.md)

## Phase 3: Agent Retry & Safe Scan Fallback
- [ ] Task: Implement Agent Retry logic to request missing command specifically
- [ ] Task: Implement "Safe Scan" fallback for deep-search of test-like files
- [ ] Task: Integrate `ReproductionInferenceService` into the main agent loop (`agent.ts` or `services/repair-agent/`)
- [ ] Task: Implement validation "dry-run" for inferred commands
- [ ] Task: Write integration tests for the full inference pipeline
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Agent Retry & Safe Scan Fallback' (Protocol in workflow.md)

## Phase 4: Final Integration & Verification
- [ ] Task: Verify end-to-end flow with a mock CI failure missing a `reproductionCommand`
- [ ] Task: Ensure telemetry and logging capture inference success/failure
- [ ] Task: Final code review and linting check
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Final Integration & Verification' (Protocol in workflow.md)
