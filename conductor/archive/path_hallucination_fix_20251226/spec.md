# Specification: File Path Hallucination Mitigation & Robust Discovery

## Overview
This track addresses a critical issue where agents (e.g., CrimsonArchitect, CyberSentinel) attempt to manipulate files using non-existent paths, leading to execution loops and failure to resolve issues. The goal is to move from "hallucinated paths" to "verified discovery" by implementing a robust path validation and discovery mechanism.

## Functional Requirements
- **Path Validation Service:** Enhance `utils/pathDetection.ts` to include a validation layer that checks path existence and provides fuzzy matching/suggestions.
- **Robust File Discovery:** Integrate path verification into the agent's decision-making process, ensuring `glob` or `search_file_content` is used when a path is uncertain.
- **Enhanced Tool Feedback:** Modify file-related tools to return actionable error messages (e.g., "Path not found. Did you mean [suggested path]?") instead of raw shell errors.
- **Automated Discovery on Failure:** When a file operation fails due to "No such file or directory", the system should automatically trigger a `glob` search for the filename.
- **Loop Detector Integration:** Update `LoopDetector` to recognize repeated path failures and force a strategy shift toward discovery.

## Non-Functional Requirements
- **Efficiency:** Path validation should be fast and use caching where appropriate.
- **Consistency:** Path normalization must ensure consistent handling of relative and absolute paths across the codebase.

## Acceptance Criteria
- Agents no longer enter loops attempting to delete/modify non-existent paths.
- If an agent provides an incorrect path, the system suggests the correct one if a similar filename exists.
- The `LoopDetector` successfully flags and breaks loops caused by missing files.
- Unit tests verify that `pathDetection.ts` correctly identifies and suggests alternatives for missing files.

## Out of Scope
- Rewriting the core agent reasoning logic (focus is on tool/utility support).
- Fixing the specific "duplicate test filename" issue (this track provides the *tools* for agents to fix it).
