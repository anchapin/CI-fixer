# Specification: File System Grounding & Hallucination Mitigation

## Overview
The CI-Fixer agents occasionally "hallucinate" file paths, leading to command failures (e.g., `No such file or directory`) and repetitive, failing loops. This track introduces a mandatory "Grounding" layer that verifies the existence of a file path before executing any file-system operation and autonomously recovers if the path is incorrect.

## Functional Requirements
- **Pre-Action Verification:** Every tool or command that interacts with a file path (including `read_file`, `write_file`, `replace`, `rm`, `mv`, etc.) must verify the file's existence before execution.
- **Autonomous Recovery (Auto-Search & Correct):** 
    - If a file is not found at the specified path, the system must automatically search for the file by name.
    - If exactly **one** high-confidence match is found, the system will silently update the path and proceed with the original operation.
    - If multiple matches or no matches are found, the operation must fail with a detailed error report.
- **Path-Aware Search Strategy:**
    - The search mechanism must prioritize matches that share directory segments with the original hallucinated path (e.g., if `backend/tests/test_file.py` is missing, look for `test_file.py` in other `backend` or `tests` subdirectories first).

## Non-Functional Requirements
- **Performance:** The grounding check must be efficient to avoid significant latency in agent operations.
- **Reliability:** The "Auto-Correct" feature must ensure high confidence to avoid performing operations on the wrong file.

## Acceptance Criteria
- [ ] Any attempt to modify or read a non-existent file triggers an automated search.
- [ ] Successful "Auto-Correction" allows the agent to complete its task without failing the initial command.
- [ ] If a file cannot be uniquely identified, the agent receives a clear error message instead of entering a loop.
- [ ] Unit tests demonstrate successful path recovery for moved or slightly misplaced files.

## Out of Scope
- Correcting paths for directories that do not exist (focus is on individual files).
- Predicting file names (the filename provided by the agent must be correct).
