# Implementation Plan: Strict Language Scoping for Error Diagnosis

## Phase 1: Core Scoping Engine [checkpoint: a426e9f]
- [x] **Task: Define Scoping Data Structures** d9fb743
- [x] **Task: Implement LanguageScopingEngine (Red Phase)** 45b08a4
- [x] **Task: Implement LanguageScopingEngine (Green Phase)** e7cc8ba
- [x] **Task: Conductor - User Manual Verification 'Phase 1: Core Scoping Engine' (Protocol in workflow.md)**

## Phase 2: Integration with Error Classification [checkpoint: 7da4820]
- [x] **Task: Enhance Error Classification (Red Phase)** 43c0f37
  - Update tests in `__tests__/unit/errorClassification.test.ts` to expect a `scope` field in the classification result.
- [x] **Task: Enhance Error Classification (Green Phase)** 4a90770
  - Modify `errorClassification.ts` to call the `LanguageScopingService` during log analysis.
  - Ensure the detected scope is included in the diagnostic metadata passed to the agent.
- [x] **Task: Conductor - User Manual Verification 'Phase 2: Integration with Error Classification' (Protocol in workflow.md)** 7da4820

## Phase 3: Agent Guidance & Tool Prioritization [checkpoint: fff76d6]
- [x] **Task: Update Agent Context (Red Phase)** 9d10eb7
  - Create an integration test in `__tests__/integration/agentScoping.test.ts` that simulates a `vitest: not found` error and asserts the agent receives scoping hints.
- [x] **Task: Update Agent Context (Green Phase)** 2496ec2
  - Update `agent.ts` (or the prompt generation logic) to explicitly instruct the agent to prioritize files matching the detected scope.
  - Modify tool-calling logic to include a "Soft Warning" if the agent attempts to modify a file clearly outside the detected scope (e.g., editing `.py` when scope is JS).
- [x] **Task: Conductor - User Manual Verification 'Phase 3: Agent Guidance & Tool Prioritization' (Protocol in workflow.md)** fff76d6

## Phase 4: Verification & Refinement
- [x] **Task: E2E Scenario Validation** c0194d6
  - Run the full agent loop against the specific "NeonWeaver" failure scenario described in the track description.
  - Verify the agent correctly identifies the JS/TS scope and avoids `requirements.txt`.
- [~] **Task: Documentation & Cleanup**
  - Update `README.md` or internal documentation regarding the new scoping mechanism.
  - Perform final refactoring and ensure code coverage >80%.
- [ ] **Task: Conductor - User Manual Verification 'Phase 4: Verification & Refinement' (Protocol in workflow.md)**