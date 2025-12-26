# Specification: Robust Reproduction Command Inference

## Overview
The CI-Fixer agent sometimes fails to provide a `reproductionCommand` when proposing a fix. Without this command, the system cannot verify the fix, leading to wasted iterations and eventual failure. This track implements an automated inference strategy to ensure a valid verification command is always available.

## Functional Requirements

### 1. Reproduction Command Inference Service
Implement a service responsible for determining the `reproductionCommand` if the agent fails to provide one.

### 2. Multi-Layered Inference Strategy (Priority Order)
1.  **Workflow Analysis:** Parse `.github/workflows/*.yml` files to extract the exact test/run commands used in the original failing CI pipeline.
2.  **File Signature Detection:** Scan for common configuration files to infer standard commands:
    -   `package.json` -> `npm test` or `bun test`
    -   `requirements.txt`, `pytest.ini`, `tox.ini` -> `pytest`
    -   `go.mod` -> `go test ./...`
    -   `Cargo.toml` -> `cargo test`
3.  **Build Tool Inspection:** Check for standard test targets in build files:
    -   `Makefile` (look for `test` or `check` targets)
    -   `build.gradle` / `pom.xml`
    -   `Rakefile`
4.  **Agent Retry:** If the above fail, explicitly task the agent to re-examine the repository and provide *only* the reproduction command.

### 3. Fallback Mechanism
-   If all automated strategies fail, execute a "Safe Scan":
    -   Search the codebase for files or directories matching `*test*`.
    -   Attempt to execute found test runners (e.g., executing scripts in a `tests/` directory).

### 4. Validation & Error Handling
-   Validate the inferred command by attempting a "dry run" in the sandbox before committing to the verification loop.
-   If the command fails basic execution, move to the next strategy in the priority list.

## Acceptance Criteria
-   The system successfully extracts reproduction commands from GitHub Workflow files.
-   The system correctly identifies and uses standard test runners based on project signatures (e.g., `pytest`, `npm test`).
-   The agent is successfully prompted to provide a command if inference fails.
-   The "Safe Scan" fallback provides a last-ditch effort to find tests.
-   Fixes are verified even when the agent initially omits the `reproductionCommand`.

## Out of Scope
-   Fixing the specific `requirements.txt` path issue (this track focuses on the *verification strategy*).
-   Manual user intervention during the automated agent loop (handled by fallback strategies).
