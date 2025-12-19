# Track Specification: Robust Dependency Conflict Handling

## 1. Overview
Enhance the CI-fixer agent's capability to robustly identify and resolve Python dependency conflicts, specifically focusing on the Pydantic v1 vs v2 conflict often triggered by libraries like `crewai`. The solution involves improved log parsing, contextual codebase analysis to determine version requirements, and ensuring multiple concurrent errors can be addressed effectively.

## 2. Functional Requirements

### 2.1 Error Detection (`errorClassification.ts`)
- Implement regex-based detection for common dependency conflict patterns in CI logs:
  - `pkg_resources.ContextualVersionConflict`
  - `pydantic.errors` related to version mismatches.
  - Specific `ImportError` messages indicating version incompatibility.
- Ensure these errors are distinct from generic "Command failed" errors.

### 2.2 Contextual Version Analysis (`FixPatternService.ts`)
- Implement logic to scan the codebase for Pydantic usage patterns to infer the required version:
  - **V2 Indicators:** `model_dump`, `model_validate`, `field_validator`.
  - **V1 Indicators:** `dict()` (on models), `validator` (root validator differences), `orm_mode`.
- If `crewai` is detected in dependencies, weigh this heavily towards Pydantic V2 unless strong V1 indicators exist.

### 2.3 Fix Strategy & Application
- Update `FixPatternService` to propose specific version pinning (e.g., `pydantic>=2.0.0` or `pydantic<2.0.0`) based on the analysis.
- Modify the fix application logic to support modifying `pyproject.toml` or `requirements.txt`.

### 2.4 Multi-Error Handling
- Update the agent's planning logic to allow addressing this dependency conflict alongside other detected errors (e.g., missing files) in the same iteration, rather than getting "distracted" and only fixing the simpler missing file error.

## 3. Non-Functional Requirements
- **Performance:** Codebase scanning for version indicators must be efficient (e.g., regex search on relevant files only).
- **Accuracy:** Minimize false positives where the agent forcefully upgrades/downgrades libraries unnecessarily.

## 4. Acceptance Criteria
- **Scenario 1:** Given a project with `crewai` (requiring Pydantic V2) and a generic `pydantic` install that resolves to V1 (causing crash), the agent detects the conflict and pins `pydantic>=2.0.0`.
- **Scenario 2:** Given a legacy project using Pydantic V1 syntax, the agent identifies V1 usage and ensures packages are compatible with V1 (or suggests downgrading conflicting new packages).
- **Scenario 3:** When both a dependency conflict and a missing file error are present, the agent plans fixes for *both* (or prioritizes the dependency fix appropriately) rather than ignoring the complex conflict.
