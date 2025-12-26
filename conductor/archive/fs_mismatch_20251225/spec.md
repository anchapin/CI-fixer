# Specification: File System State Mismatch Fix

## Overview
This track addresses an issue where the agent attempts to perform operations (like `rm` or `mv`) on files that do not exist at the specified path, leading to wasted cycles and command failures. The fix involves enhancing the `run_shell_command` tool wrapper to verify paths before execution.

## Functional Requirements
- **Path Identification:** Automatically detect potential file paths within shell command strings using regex-based heuristics (e.g., strings containing `/`, `\`, or file extensions).
- **Pre-Execution Verification:**
    - Normalize detected paths to handle relative/absolute differences and case-sensitivity.
    - Check for the existence of identified paths before running the command.
- **Dynamic Path Recovery:**
    - If a path is missing, perform a search starting from the project root.
    - Leverage `git ls-files` for efficient searching of tracked files.
    - Use a similarity threshold (e.g., Levenshtein distance) to identify the most likely intended file.
- **Agent Feedback:** If a path is missing and a match is found, the tool should return a structured error or warning informing the agent of the mismatch and suggesting the corrected path.

## Non-Functional Requirements
- **Performance:** Path verification and fuzzy searching must be fast enough not to introduce significant latency to tool execution.
- **Reliability:** Avoid false positives in path detection to prevent blocking valid commands.

## Acceptance Criteria
- [ ] Commands like `rm <non_existent_path>` are intercepted before execution.
- [ ] The system correctly identifies the intended file if it exists elsewhere in the project.
- [ ] The agent receives a clear message when a path mismatch is detected.
- [ ] No regression in performance for standard commands where paths are correct.

## Out of Scope
- Modifying the underlying shell or OS behavior.
- Implementing a full-blown virtual file system.
