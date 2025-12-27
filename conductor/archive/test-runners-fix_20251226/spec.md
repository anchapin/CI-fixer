# Specification: Missing Test Runners (Environment Issue)

## Overview
Currently, several agents (ZeroOperator, CrimsonArchitect, CyberSentinel) are failing to verify fixes because common test runners (`pytest`, `vitest`, etc.) are missing from the default execution environment. This causes valid fixes to be rejected or triggers infinite retry loops. This track implements a hybrid solution: a more comprehensive base Docker image combined with automated on-demand installation for missing dependencies.

## Functional Requirements

### 1. Enhanced Base Docker Image
- Develop or select a "thicker" base Docker image that includes:
    - **Runtimes:** Node.js (LTS), Bun, Python (3.10+), Go.
    - **Package Managers:** `npm`, `yarn`, `pnpm`, `pip`, `poetry`.
    - **Test Runners:** `pytest`, `unittest`, `tox` (Python); `vitest`, `jest`, `mocha` (JS/TS).

### 2. Automated On-Demand Provisioning
- Update the `ProvisioningService` or equivalent to detect when a required test runner is missing.
- Implement automatic, silent installation of detected missing runners before test execution.
- Ensure the agent can handle version-specific requirements if the base image version is insufficient.

### 3. Environment Detection Integration
- Refine the environment detection logic to verify the presence of a runner *before* attempting to execute a test command, triggering the on-demand installer if necessary.

## Non-Functional Requirements
- **Performance:** The "thicker" image should not significantly increase container startup time.
- **Reliability:** On-demand installations must be robust and handle common network or package manager failures.
- **Transparency:** While installations are automatic, they should be recorded in internal logs for debugging and audit purposes.

## Acceptance Criteria
- [ ] A new or updated Dockerfile/image exists containing the specified runtimes and runners.
- [ ] Agents can successfully execute `pytest` and `vitest` in the default sandbox without manual installation.
- [ ] If a runner (e.g., a specific version of `jest`) is missing, the system automatically installs it and the test run eventually succeeds.
- [ ] Verification signals correctly reflect test results rather than "command not found" errors.

## Out of Scope
- Support for obscure or highly proprietary test runners.
- Significant refactoring of the entire sandbox architecture beyond image and provisioning updates.
