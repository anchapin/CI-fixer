# Specification: Environment Context Confusion (Bun vs. Node)

## Overview
The current system fails to correctly identify and execute tasks in projects that use the Bun runtime, particularly those migrating from or hybridizing with Node/Vitest. This leads to errors such as `Cannot bundle built-in module "bun:test"` when the agent attempts to run standard Node/Docker commands on Bun-specific code.

The goal is to implement context-sensitive environment detection and adaptive execution to ensure the agent uses the correct runtime (Bun or Node) based on project indicators and runtime errors.

## Functional Requirements

### 1. Bun Environment Detection
The system must proactively look for Bun-specific indicators in the project:
- Presence of `bun.lockb` in the project root.
- Presence of `bunfig.toml` in the project root.
- Scanning source files for imports starting with `bun:` (e.g., `import { test } from "bun:test"`).

### 2. Context-Sensitive Runtime Switching
The system should prioritize execution based on the following strategy:
- **Initial Execution:** Default to the primary detected environment (Node/Vitest if `package.json` and `vitest.config.ts` are present).
- **Dynamic Switch:** If a command fails with errors indicating a missing Bun environment (e.g., `Cannot bundle built-in module "bun:test"` or similar Bun-specific runtime errors), the system must:
    - Re-evaluate the project context.
    - Switch the execution strategy to use Bun commands.

### 3. Command Execution Adjustments
When the Bun environment is active or triggered:
- Use `bun install` for dependency management.
- Use `bun test` or `bun run test` for test execution.
- Ensure the Docker/Sandbox environment is provisioned with the Bun runtime.

### 4. Environment Provisioning
- Update the sandbox/container setup logic to include Bun installation if any Bun indicators are detected or if a Bun-switch is triggered.

## Non-Functional Requirements
- **Performance:** Detection logic should be efficient and not significantly delay the initial agent setup.
- **Reliability:** Switching logic must be robust to avoid infinite loops between runtimes.

## Acceptance Criteria
- [ ] Agent correctly identifies `bun.lockb` and `bunfig.toml` files.
- [ ] Agent detects `bun:` imports in source code.
- [ ] If a Node-based test run fails with Bun-related errors, the agent successfully retries or switches subsequent runs to `bun test`.
- [ ] Sandbox environments successfully install and run Bun when required.
- [ ] The agent correctly handles "hybrid" projects without breaking existing Node functionality.

## Out of Scope
- Converting Node-specific projects to Bun projects.
- Supporting runtimes other than Node and Bun in this track.
