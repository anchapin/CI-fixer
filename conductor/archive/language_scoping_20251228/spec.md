# Specification: Strict Language Scoping for Error Diagnosis

## Overview
Implement an intelligent "Language Scoping" mechanism to prevent the agent from applying fixes to incorrect technology stacks (e.g., trying to fix a JS error by editing Python files). The system will use a hybrid approach of keyword detection and manifest validation to prioritize relevant files and tools.

## Functional Requirements

### 1. Scope Detection Engine
- **Hybrid Strategy:** Detect the language scope by scanning error logs for specific keywords and validating the presence of corresponding manifest files in the working directory.
- **JS/TS Scope:** 
    - Keywords: `npm`, `yarn`, `vitest`, `jest`, `mocha`, `tsc`, `node`, `bun`
    - Manifests: `package.json`, `tsconfig.json`, `package-lock.json`
- **Python Scope:**
    - Keywords: `pytest`, `pip`, `python`, `tox`, `ImportError`, `ModuleNotFoundError`, `pip3`
    - Manifests: `requirements.txt`, `pyproject.toml`, `setup.py`, `environment.yml`
- **Go Scope:**
    - Keywords: `go`, `go test`, `golang`
    - Manifests: `go.mod`, `go.sum`
- **Generic/System Scope:**
    - Keywords: `docker`, `github/workflows`, `bash`, `sh`, `make`
    - *Note:* This scope bypasses language-specific restrictions to allow system-level fixes.

### 2. Priority-Based Tool Execution
- **Soft Scoping:** When a specific scope (JS, Python, or Go) is identified, the agent must:
    - Prioritize searching and modifying files within that scope (e.g., matching file extensions and manifest files).
    - If a fix within the detected scope fails, the agent may expand its search/actions globally as a fallback.
- **Context Injection:** The error classifier should inject the detected scope into the agent's context to guide tool selection.

## Non-Functional Requirements
- **Low Latency:** Scope detection should be performed as part of the initial log analysis without significant overhead.
- **Extensibility:** The keyword/manifest mapping should be easily configurable for future language support.

## Acceptance Criteria
- [ ] Error logs containing `vitest` correctly trigger JS/TS scoping.
- [ ] Error logs containing `pytest` correctly trigger Python scoping.
- [ ] Agent correctly prioritizes `package.json` for `vitest`-related errors and avoids touching `requirements.txt`.
- [ ] System-level errors (e.g., Docker) are correctly identified as Generic and not restricted to a language scope.
- [ ] Unit tests verify the `ScopeDetectionEngine` with various log snippets.

## Out of Scope
- Hard-blocking all cross-language tool calls (we will use priority-based scoping instead).
- Automatic installation of language runtimes (handled by the Provisioning Service).