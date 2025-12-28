# Specification: Environment State Persistence

## Context
Agents are currently getting stuck in a loop where they successfully install a dependency (e.g., `pip install pytest`), but the immediately following verification command fails with "command not found". This indicates that the `PATH` update from the installation is not persisting or not being picked up by the subsequent shell session/command execution in the sandbox.

## Problem
- **Symptom:** "Not Found" Loop. Install -> Success -> Run -> Fail (Not found) -> Install ...
- **Affected Components:** `Sandbox` (command execution), `ProvisioningService`.
- **Impact:** Inability to verify fixes or run tests, leading to wasted tokens and stuck agents.

## Requirements
1.  **Persistence:** Modifications to the environment (specifically `PATH` updates from package managers like `pip`, `npm`, `cargo`) must be visible to subsequent commands executed in the same sandbox session.
2.  **Robustness:** If direct binary access is flaky, the system should prefer language-specific module execution (e.g., `python -m pytest` instead of `pytest`).

## Proposed Solution
1.  **Session Management:** Ensure that the sandbox's command execution mechanism either uses a persistent shell session or explicitly re-sources environment profiles (e.g., `.bashrc`, `.profile`) before every command.
2.  **Path Refresh:** Explicitly capture the `PATH` after an installation step and inject it into future commands.
3.  **Invocation Strategy:** Update the `CommandGenerator` or logic responsible for constructing test commands to use `python -m <package>` for Python environments when applicable.

## Success Criteria
- A reproduction test case (install `X`, run `X`) passes successfully on the first attempt after installation.
- The "command not found" error for installed packages is eliminated.
