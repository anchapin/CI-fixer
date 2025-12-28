# Implementation Plan: Strict Language Scoping for Error Diagnosis

## Phase 1: Core Scoping Engine [checkpoint: a426e9f]
- [x] **Task: Define Scoping Data Structures** d9fb743
- [x] **Task: Implement LanguageScopingEngine (Red Phase)** 45b08a4
- [x] **Task: Implement LanguageScopingEngine (Green Phase)** e7cc8ba
- [x] **Task: Conductor - User Manual Verification 'Phase 1: Core Scoping Engine' (Protocol in workflow.md)**

## Phase 2: Integration with Error Classification
- [ ] **Task: Enhance Error Classification (Red Phase)**
  - Update tests in `__tests__/unit/errorClassification.test.ts` to expect a `scope` field in the classification result.
- [ ] **Task: Enhance Error Classification (Green Phase)**
  - Modify `errorClassification.ts` to call the `LanguageScopingService` during log analysis.
  - Ensure the detected scope is included in the diagnostic metadata passed to the agent.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2: Integration with Error Classification' (Protocol in workflow.md)**

## Phase 3: Agent Guidance & Tool Prioritization
- [ ] **Task: Update Agent Context (Red Phase)**
  - Create an integration test in `__tests__/integration/agentScoping.test.ts` that simulates a `vitest: not found` error and asserts the agent receives scoping hints.
- [ ] **Task: Update Agent Context (Green Phase)**
  - Update `agent.ts` (or the prompt generation logic) to explicitly instruct the agent to prioritize files matching the detected scope.
  - Modify tool-calling logic to include a "Soft Warning" if the agent attempts to modify a file clearly outside the detected scope (e.g., editing `.py` when scope is JS).
- [ ] **Task: Conductor - User Manual Verification 'Phase 3: Agent Guidance & Tool Prioritization' (Protocol in workflow.md)**

## Phase 4: Verification & Refinement
- [ ] **Task: E2E Scenario Validation**
  - Run the full agent loop against the specific "NeonWeaver" failure scenario described in the track description.
  - Verify the agent correctly identifies the JS/TS scope and avoids `requirements.txt`.
- [ ] **Task: Documentation & Cleanup**
  - Update `README.md` or internal documentation regarding the new scoping mechanism.
  - Perform final refactoring and ensure code coverage >80%.
- [ ] **Task: Conductor - User Manual Verification 'Phase 4: Verification & Refinement' (Protocol in workflow.md)**