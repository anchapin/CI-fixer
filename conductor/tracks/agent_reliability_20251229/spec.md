# Specification: Multi-Layer Agent Reliability Enhancement

## Overview
Based on production failure analysis (ci_fixer_debug_2025-12-29T15-43-35-609Z.json), the CI-fixer agent experiences four critical failure modes: (1) Path Resolution Failure - agent "gets lost" by attempting operations on files without verified absolute paths; (2) Strategy Loops - complexity rises to 16.8 with 9 attempts as agent repeats ineffective strategies; (3) Verification Gap - agent proceeds without reproduction commands, coding blind; (4) Resource Exhaustion - max iterations reached without success. This track implements three synergistic improvements to address all failure modes.

## Decision Reference
**Decision ID:** `dec-cc3a5d60`
**Decision Date:** 2025-12-29
**DRR Location:** `.quint/decisions/dec-cc3a5d60-multi-layer-agent-reliability.md`

## Functional Requirements

### Layer 1: Path Resolution Enhancement
- **Absolute Path Validation:** Before any file operation (read, write, delete), the agent must validate and convert paths to absolute form.
- **Pre-Operation Verification:** Integrate with existing `findClosestFile` and `validateFileExists` to verify file existence before attempting operations.
- **Search Fallback:** When a file is not found at the expected path, automatically invoke search tools to locate the file before proceeding.
- **Error Context:** When path resolution fails, provide clear error messages indicating the discrepancy between expected and actual paths.

### Layer 2: Reproduction-First Workflow
- **Reproduction Command Requirement:** The agent MUST have a valid reproduction command before attempting any code fixes.
- **Pre-Fix Validation:** In the graph coordinator, check for `reproductionCommand` presence before entering the implementation phase.
- **Inference Enhancement:** Enhance the existing `ReproductionInferenceService` to infer commands when missing, but require confirmation before proceeding without one.
- **Verification Enforcement:** In the verification node, if no reproduction command exists, mark the attempt as incomplete and request human guidance.

### Layer 3: Strategy Loop Detection
- **Complexity Monitoring:** Build on existing `complexity-estimator.ts` and `detectConvergence` function in the graph coordinator.
- **Divergence Detection:** Detect when complexity is increasing (diverging) rather than decreasing or stable.
- **Halt Mechanism:** When divergence is detected and complexity exceeds threshold (e.g., >15) for >2 iterations without progress, halt execution and request human intervention.
- **Human Intervention Trigger:** Provide clear context about the loop, failed attempts, and suggest alternative approaches to the human.

## Non-Functional Requirements
- **Backward Compatibility:** All changes must be additive and not break existing functionality.
- **Performance:** Path validation should add <100ms overhead per file operation.
- **Testability:** Each layer must have corresponding unit and integration tests.
- **Coverage:** Maintain >80% code coverage threshold.
- **Observability:** Add logging/telemetry for all three layers to monitor effectiveness.

## Acceptance Criteria
- [ ] Layer 1: File operations use absolute paths with pre-validation
- [ ] Layer 1: Path resolution failures are caught early with clear error messages
- [ ] Layer 2: Agent requires reproduction command before implementation phase
- [ ] Layer 2: Verification phase fails gracefully when reproduction command is missing
- [ ] Layer 3: Agent halts when complexity diverges beyond threshold
- [ ] Layer 3: Human intervention is triggered with context about the loop
- [ ] All layers have unit tests with >80% coverage
- [ ] Integration tests demonstrate all three failure modes are prevented
- [ ] No regressions in existing functionality (all tests pass)

## Out of Scope
- Complete rewrite of agent architecture
- Changes to database schema
- Modifications to the graph DAG structure (only node logic changes)
- Cross-run learning (loop detection is per-session only)

## Success Metrics
- Reduce "agent lost" failures by >90%
- Reduce strategy loop iterations by >70%
- Increase fix success rate by >30%
- Maintain >80% test coverage
- Zero regressions in existing tests

## Implementation Effort Estimate
- Layer 1: 2-3 hours
- Layer 2: 1-2 hours
- Layer 3: 2-3 hours
- **Total: 5-8 hours**

## Risk Assessment
- **LOW RISK:** Changes are additive, not breaking
- **LOW RISK:** Builds on existing systems (complexity estimator, reproduction inference)
- **MEDIUM RISK:** Halt mechanism may trigger false positives (needs threshold tuning)
- **MITIGATION:** Can be rolled back incrementally layer by layer if needed

## Dependencies
- Existing `services/complexity-estimator.ts`
- Existing `services/reproduction-inference.ts`
- Existing `agent/graph/coordinator.ts`
- Existing `agent/worker.ts`
- Existing `agent/graph/nodes/verification.ts`
