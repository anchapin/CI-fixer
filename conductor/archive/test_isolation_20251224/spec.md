# Specification: Intelligent Test Isolation

## Overview
This track addresses the "All-or-Nothing" fallacy where the agent executes the entire project test suite for isolated changes. This often leads to false negatives when unrelated parts of the codebase (e.g., frontend dependencies) are broken, incorrectly signaling that a specific fix (e.g., a backend dependency update) has failed. We will implement intelligent test isolation to correlate modified files with their specific, relevant test suites.

## Functional Requirements
- **Automated Test Mapping:** The system must map file patterns to specific test commands:
    - `*.py`, `requirements.txt` -> `pytest` (Backend)
    - `*.ts`, `*.tsx`, `*.js` (Frontend context) -> `npm run test:frontend`
    - `*.ts` (Backend context) -> `npm run test:backend`
    - `package.json`, `pnpm-lock.yaml`, etc. -> Full suite (Frontend + Backend)
- **On-Demand Test Generation:** If a modification is made to a file or module that lacks existing test coverage or a clear suite mapping, the agent MUST autonomously create a new unit test.
    - **Location:** `__tests__/` adjacent to the file or `tests/` for Python.
    - **Naming:** Follow project conventions (`*.test.ts`, `test_*.py`).
    - **Scope:** Minimal unit test covering the specific logic modified.
- **Verification Logic Update:** The `runSandboxTest` and verification handlers must be updated to use the isolated test command rather than a hardcoded "run all" command.

## Non-Functional Requirements
- **Efficiency:** Drastically reduce MTTR by avoiding execution of unrelated, potentially flaky test suites.
- **Robustness:** The isolation logic must be conservative; if a change spans multiple domains, it should default to the most comprehensive overlap.

## Acceptance Criteria
- [ ] Agent modifies a Python backend file; only `pytest` is executed for verification.
- [ ] Backend fix verification succeeds even if the frontend test suite is currently in a broken state.
- [ ] Agent modifies a module with no existing tests; it creates a new test file and uses it for verification.
- [ ] Logs clearly indicate which subset of tests was selected and why.

## Out of Scope
- Global CI/CD workflow optimization (this is focused on the agent's internal verification loop).
