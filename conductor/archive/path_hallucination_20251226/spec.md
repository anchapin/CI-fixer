# Specification: Path Hallucination & Logic Loop Mitigation

## Overview
This track addresses a critical reliability issue where agents (CrimsonArchitect, CyberSentinel) enter infinite loops by repeatedly targeting non-existent file paths ("Path Hallucination"). The system currently allows agents to ignore "No such file or directory" errors, leading to wasted tokens and execution timeouts.

## Functional Requirements
1.  **Tool Execution Pre-processor:** Implement a middleware for all filesystem-related tools (e.g., `read_file`, `replace`, `write_file`, `run_shell_command` with file ops) that validates path existence before execution.
2.  **Automated Directory Discovery:** If a targeted path does not exist, the system must automatically execute a directory listing (`ls` or equivalent) of the closest existing parent directory and provide this context to the agent.
3.  **Fuzzy Path Suggestion:** Use `Fuse.js` (already in tech stack) to identify the most likely intended file when a hallucinated path is provided and include this in the error message.
4.  **Loop Detection Logic:** 
    *   Maintain a "Hallucination Counter" per agent session.
    *   After 2 consecutive hallucinations for the same or similar paths, force a "Strategy Shift" instruction into the agent's next prompt, requiring them to use discovery tools (glob, search) instead of modification tools.
5.  **Enhanced Error Reporting:** Return structured error messages that explicitly flag "PATH_NOT_FOUND" and provide the discovered parent directory structure.

## Non-Functional Requirements
*   **Performance:** Path validation and fuzzy searching should add <100ms latency to tool execution.
*   **Reliability:** The mitigation must prevent agents from reaching the maximum iteration limit due to path-related loops.

## Acceptance Criteria
*   [ ] Agents stop execution of a modification tool if the path is hallucinated.
*   [ ] The system automatically provides parent directory contents when a path is missing.
*   [ ] Fuzzy search correctly identifies `test_cache_simple.py` when an agent hallucinations a nested path like `backend/tests/coverage_improvement/manual/services/test_cache_simple.py`.
*   [ ] A unit test demonstrates the "Strategy Shift" prompt being injected after 2 consecutive hallucinations.

## Out of Scope
*   Fixing the root cause of why the LLM hallucinations (this is a mitigation layer).
*   Automatic path correction (the agent must still make the final decision to use the correct path).
