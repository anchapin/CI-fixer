# Specification: Enhanced Dockerfile Repair Reliability

## Overview
This track aims to improve CI-fixer's ability to autonomously repair Dockerfiles by preventing common syntax errors. Specifically, it addresses the introduction of typos in common flags and the invalid use of inline comments within multi-line `RUN` commands. We will achieve this through a "trust but verify" approach: improving the agent's instructions (prompts and runbooks) and implementing automated validation during the verification phase.

## Functional Requirements

### 1. Agent Instruction Updates (The "Trust")
- **Prompt Engineering**: Update `prompts/execution/code-fix-v1.md` to include explicit constraints for Dockerfiles:
    - FORBID inline comments (starting with `#`) inside multi-line `RUN` instructions (after `\
`).
    - Emphasize accuracy for common `apt-get` flags (e.g., `--no-install-recommends`).
- **Patch Generation Logic**: Update `services/repair-agent/patch-generation.ts` to programmatically reinforce these constraints when the target file is a Dockerfile.
- **Runbook Enhancement**: Update or create a runbook in `runbooks/docker/` that documents these specific failure patterns and provides correct examples to be used as few-shot context.

### 2. Automated Validation (The "Verify")
- **Hadolint Integration**:
    - Update the sandbox environment preparation (in `services/sandbox/SandboxService.ts` or similar) to ensure `hadolint` is installed.
    - Integrate `hadolint` into the agent's verification phase. If a Dockerfile is modified, the agent must run `hadolint` on it.
- **Docker CLI Verification**:
    - Add a step to the verification phase to run `docker build` (e.g. `docker build -f Dockerfile .`) to ensure the Dockerfile is parsable by the Docker engine.

### 3. Spelling Check (New)
- **CSpell Integration**: Integrate `cspell` into the post-processing pipeline.
- **Automated Scanning**: Identify misspelled words in generated patches.
- **Threshold Enforcement**: Define an acceptable error rate (e.g., maximum number of spelling errors before lowering confidence or flagging for review).

### 4. Error Feedback Loop
- If `hadolint` or the Docker CLI build check fails, the output must be fed back to the agent as a "verification failure," allowing it to iterate and fix its own syntax errors.

## Non-Functional Requirements
- **Performance**: Validation checks should be lightweight to avoid significant delays in the agent's loop.
- **Reliability**: The sandbox must reliably provide the necessary linting tools (`hadolint`).

## Acceptance Criteria
- [ ] Agent successfully fixes a Dockerfile without introducing inline comments in multi-line `RUN` blocks.
- [ ] Agent correctly identifies and uses flags like `--no-install-recommends`.
- [ ] Modified Dockerfiles are automatically linted with `hadolint` during the verification phase.
- [ ] `docker build` checks are performed to ensure parsability.
- [ ] Automated tests (unit or integration) verify that `hadolint` and Docker CLI checks are correctly triggered for Dockerfile changes.

## Out of Scope
- Optimizing Docker images for size or performance beyond basic linting recommendations.
- Supporting non-standard Dockerfile formats.
