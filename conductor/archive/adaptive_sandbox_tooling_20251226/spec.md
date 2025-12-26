# Specification: Adaptive Sandbox Tooling & Infrastructure Detection

## Overview
This track addresses a critical failure mode where agents correctly identify code issues but fail verification because the sandbox environment lacks required tools (e.g., `pytest`, `vitest`, `pip`). The goal is to make the sandbox "infrastructure-aware" so it can autonomously detect, report, and provision missing dependencies.

## Functional Requirements
- **Autonomous Provisioning:** The agent must attempt to install missing runtimes and test runners (Node.js, Python, package managers) when detected.
- **Pre-flight Probing:** Implement an "Initial Capability Probe" that runs `tool --version` for all expected tools upon sandbox startup.
- **Error Classification:** Distinguish between "Logic Failures" (test failures, exit code 1) and "Infrastructure Failures" (command not found, exit code 127) using shell exit codes and regex-based stderr analysis.
- **Dependency Validation:** Cross-reference tools required by project manifests (`package.json`, `requirements.txt`) against the available system PATH.
- **Dynamic Path Management:** Automatically refresh the sandbox PATH after installation attempts to ensure new tools are immediately available.

## Non-Functional Requirements
- **Resilience:** The system should not enter infinite loops trying to install the same failing tool.
- **Observability:** Infrastructure-related failures must be clearly flagged in logs to avoid confusing them with bug-fix failures.

## Acceptance Criteria
- [ ] Sandbox identifies when `vitest` or `pytest` is missing and identifies it as an infrastructure error.
- [ ] Agent attempts to install the missing tool using the appropriate package manager.
- [ ] Verification succeeds after the tool is provisioned.
- [ ] "Command not found" errors no longer result in a "failed fix" status but an "environment setup" status.

## Out of Scope
- Building a full-blown OS package manager.
- Support for proprietary or non-standard build tools not mentioned in the tech stack.
