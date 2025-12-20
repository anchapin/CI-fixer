# Track Specification: Robust Sandbox File Discovery

## 1. Overview
This track aims to improve the ci-fixer agent's ability to handle missing file references within the sandbox environment (the cloned repository of a failed CI run). The goal is to prevent the agent from making erroneous edits (like modifying a Dockerfile incorrectly) when a referenced file (e.g., `ai-engine-requirements.txt`) is not found at the expected path.

## 2. Functional Requirements

### 2.1 Enhanced File Discovery Logic
When a referenced file is missing, the agent shall execute a multi-layered search strategy:
- **Recursive Search:** Search the entire repository for the exact filename.
- **Semantic/Fuzzy Search:** Use fuzzy matching or semantic search to find files with similar names or purposes.
- **Git History Analysis:** Check the git log to determine if the file was recently renamed, moved, or deleted.

### 2.2 Candidate Verification Protocol
Before substituting a missing file with a "similar" candidate found during search, the agent must:
- **Content Analysis:** Verify the candidate's content matches the expected purpose (e.g., if looking for requirements, ensure the file contains valid dependency declarations).
- **Dry Run Validation:** Attempt to run the build or command with the candidate path to verify it resolves the immediate error without side effects.
- **Usage Check:** Ensure the candidate file isn't already correctly mapped to a different purpose, avoiding duplicate reference conflicts.

### 2.3 Safe Fallback & Placeholder Generation
If a file is definitively determined to be missing and no suitable replacement is found:
- **Heuristic Generation:** The agent should attempt to generate a safe placeholder file based on project context (e.g., an empty `requirements.txt` if the build requires it but the specific module requirements are missing).
- **Contextual Awareness:** The agent must differentiate between "critical missing files" (requiring generation) and "stale references" (where removing the reference might be better).

## 3. Non-Functional Requirements
- **Efficiency:** Search and history lookups must be performed within reasonable time limits to avoid stalling the agent.
- **Stability:** Fixes involving file path substitutions or placeholder generation must be verified in the sandbox before committing.

## 4. Acceptance Criteria
- **Scenario 1:** Agent is looking for `ai-engine-requirements.txt` which was renamed to `requirements.txt`. Agent finds it via fuzzy search, verifies contents, updates build script, and successfully verifies the fix.
- **Scenario 2:** Agent is looking for a requirements file that doesn't exist. Instead of mangling the Dockerfile, it generates an empty placeholder file to satisfy the build step and continues.
- **Scenario 3:** Agent detects that a file reference in a Dockerfile points to a file that was deleted in a previous commit. It correctly identifies the reference as stale and proposes removal rather than redirection.
