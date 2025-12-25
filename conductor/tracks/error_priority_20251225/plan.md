# Plan: Implement Error Prioritization Hierarchy

## Phase 1: Implementation of Error Hierarchy
- [x] Task: Analyze `errorClassification.ts` and current error selection logic.
    -   Identify how errors are currently typed and where the agent selects which error to fix.
- [x] Task: Create failing unit tests for priority sorting (Red Phase).
    -   Create a new test file (e.g., `__tests__/unit/errorPrioritization.test.ts`).
    -   Define test cases with mixed log inputs (e.g., containing both "Module not found" and "Assertion failed").
    -   Assert that the system identifies the "Module not found" error as the primary/highest priority error.
- [x] Task: Implement `ErrorPriority` in `errorClassification.ts` (Green Phase).
    -   Define the priority hierarchy:
        1. Environment/Dependency
        2. Linting/Build
        3. Runtime/Infrastructure
        4. Test Assertion
    -   Update the `classifyError` ( or equivalent) function to assign these priorities to detected errors.
- [x] Task: Update Error Selection Logic (Green Phase).
    -   Modify the consumer logic (e.g., in `agent/` or `services/`) to sort diagnosed errors by `priority` (ascending) before selection.
- [ ] Task: Conductor - User Manual Verification 'Implementation of Error Hierarchy' (Protocol in workflow.md)
