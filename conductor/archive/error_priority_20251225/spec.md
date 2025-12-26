# Specification: Error Prioritization Hierarchy

## Overview
The goal of this track is to implement a formal error prioritization hierarchy within the agent's diagnostic logic. Currently, the agent can become distracted by secondary errors (like test assertion failures) while ignoring root-cause infrastructure or runtime failures (like missing dependencies or frontend crashes). By introducing a priority-based classification, the agent will be forced to resolve blocking "Infrastructure/Build" issues before attempting to fix logic-based "Test Assertion" failures.

## Functional Requirements
- **Define Priority Levels:** Implement a clear ranking system for error types:
    1. **Environment/Dependency Errors** (Priority: 1 - Highest)
    2. **Linting/Build Errors** (Priority: 2)
    3. **Runtime/Infrastructure Errors** (Priority: 3)
    4. **Test Assertion Failures** (Priority: 4 - Lowest)
- **Enhanced Classification:** Update `errorClassification.ts` to assign these priority levels to detected errors based on log patterns and error messages.
- **Sorting Logic:** Ensure that when multiple errors are detected, the agent identifies the one with the highest priority (lowest numerical value) as the primary target for the next fix iteration.

## Non-Functional Requirements
- **Maintainability:** The hierarchy should be easily adjustable if new error categories are identified in the future.
- **Performance:** Error classification and sorting should add negligible latency to the diagnostic phase.

## Acceptance Criteria
- [ ] `errorClassification.ts` is updated with a `Priority` enum or mapping.
- [ ] The agent correctly identifies a "missing module" or "frontend crash" as a higher priority than a "test expectation mismatch" in the same log output.
- [ ] Unit tests verify that the classification logic correctly assigns priorities to various sample log snippets.

## Out of Scope
- Modifying the actual fix generation logic (LLM prompts) except where necessary to focus on the prioritized error.
- Refactoring the entire `services/error-clustering.ts` unless required for the hierarchy implementation.
