# Implementation Plan: Robust Dependency Conflict Handling

This plan outlines the steps to enhance the CI-fixer's ability to handle complex Python dependency conflicts (like Pydantic v1 vs v2) and ensure it remains focused when multiple issues are present.

## Phase 1: Error Detection Enhancements [checkpoint: 2d5a884]
*Goal: Accurately identify dependency conflicts from CI logs.*

- [x] Task: Write failing tests for dependency conflict detection in `errorClassification.test.ts`. Focus on `pkg_resources.ContextualVersionConflict` and Pydantic-specific import errors. 9e4172b
- [x] Task: Update `errorClassification.ts` with regex patterns to detect these conflicts and categorize them as `DEPENDENCY_CONFLICT`. 9e4172b
- [x] Task: Verify that the new classification works for both simple and complex log outputs. 9e4172b
- [x] Task: Conductor - User Manual Verification 'Phase 1' (Protocol in workflow.md) 2d5a884

## Phase 2: Contextual Analysis and Fix Generation
*Goal: Determine the required Pydantic version and generate the appropriate fix.*

- [ ] Task: Write failing tests for `FixPatternService.ts` to verify contextual Pydantic version detection (V1 vs V2 indicators).
- [ ] Task: Implement `analyzePydanticVersionRequirement` in `FixPatternService.ts` to scan the codebase for `model_dump` (V2) vs `dict()` (V1) etc.
- [ ] Task: Implement logic to generate `pip install` or file modification fixes (e.g., updating `requirements.txt` or `pyproject.toml`) for pinning the correct version.
- [ ] Task: Conductor - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Multi-Error Coordination
*Goal: Prevent the agent from getting distracted by simpler errors when a critical dependency conflict exists.*

- [ ] Task: Write failing tests in `__tests__/integration/agent_flow.test.ts` (or equivalent) that simulate a scenario with both a dependency conflict and a missing file.
- [ ] Task: Update the agent's planning logic (likely in `agent.ts` or `services/orchestration/`) to ensure it prioritizes or includes the dependency fix in its execution plan.
- [ ] Task: Refactor error collection to ensure all high-confidence errors are reported to the planner.
- [ ] Task: Conductor - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Final Verification and Cleanup
*Goal: Ensure system-wide stability and documentation.*

- [ ] Task: Run full regression test suite to ensure no breakage in existing fix patterns.
- [ ] Task: Update any relevant documentation or runbooks regarding Python dependency handling.
- [ ] Task: Conductor - User Manual Verification 'Phase 4' (Protocol in workflow.md)
