# Specification: Robust File Path Verification

## Overview
This track addresses the issue of "File Path Hallucination" where the agent assumes the existence of a file path without verification, leading to "No such file or directory" errors during execution. We will enhance the Tool Orchestrator's internal logic to automatically verify and potentially recover from incorrect file paths before executing critical file operations.

## Functional Requirements
- **Mandatory Pre-verification:** The system must verify the existence of target file paths before executing the following operations:
    - `run_shell_command` involving `mv`, `cp`, `rm`.
    - `read_file`.
    - `replace`.
    - `write_file` (for the parent directory/existing file).
- **Auto-Recovery Search:** If a specified file path does not exist, the tool should automatically perform a project-wide search (respecting `.gitignore`) for the filename.
- **Intelligent Correction:**
    - If **exactly one** high-confidence match is found elsewhere in the project, the tool should automatically use that path, log the correction, and proceed with the operation.
    - If **multiple** matches are found, the operation must fail with an error message listing all possible matches and advising the agent to verify the path.
    - If **no** matches are found, the operation must fail with a standard "File not found" error, suggesting the agent use `glob` or `find`.
- **Telemetry/Logging:** Every automatic path correction must be logged to help monitor agent behavior and the effectiveness of the recovery logic.

## Non-Functional Requirements
- **Performance:** Auto-search should be efficient (e.g., using existing indexing if available or optimized `find`/`glob` patterns).
- **Reliability:** The auto-correction logic must be conservative to avoid applying changes to the wrong file (e.g., matching by filename + extension).

## Acceptance Criteria
- [ ] Agent attempts to `mv` a file with a slightly incorrect path; the system corrects it and the command succeeds.
- [ ] Agent attempts to `read_file` at a non-existent path; the system finds a unique match and returns the content of the correct file.
- [ ] Agent attempts to `replace` in a file with duplicate names in different directories; the system fails and lists all options.
- [ ] Logs show instances where path hallucinations were successfully intercepted and corrected.

## Out of Scope
- Modifying the core LLM prompts for path verification (this is a tool-level safeguard).
- Real-time "spatial awareness" UI (this is backend logic).
