# Plan: Enhanced Dockerfile Repair Reliability

## Phase 1: Knowledge & Prompting Improvements [checkpoint: cba05cb]
- [x] Task: Update `prompts/execution/code-fix-v1.md` to include explicit Dockerfile syntax rules (no inline comments in RUN, flag accuracy). 1a7aa45
- [x] Task: Create `runbooks/docker/syntax-errors.md` documenting common pitfalls (typos, comment errors) and their solutions. 1a7aa45
- [x] Task: Write unit tests for `services/repair-agent/patch-generation.ts` to verify Dockerfile constraint enforcement. d10e9bd
- [x] Task: Implement Dockerfile-specific logic in `services/repair-agent/patch-generation.ts` to avoid known bad patterns. d10e9bd
- [x] Task: Integrate `cspell` into the post-processing pipeline to flag misspelled words. 7fad0ae
- [x] Task: Conductor - User Manual Verification 'Knowledge & Prompting Improvements' (Protocol in workflow.md) cba05cb

## Phase 2: Sandbox & Validation Tooling [checkpoint: 6882aaf]
- [x] Task: Update `services/sandbox/SandboxService.ts` to ensure `hadolint` is installed during sandbox initialization. 74535f5
- [x] Task: Write unit tests for a new `DockerfileValidator` service or utility. 3b6253b
- [x] Task: Implement `DockerfileValidator` that executes `hadolint` and `docker build` (parsability check). 3b6253b
- [x] Task: Integrate `DockerfileValidator` into the agent's verification workflow (likely in `services/repair-agent/` or a graph node). 99c6df6
- [x] Task: Conductor - User Manual Verification 'Sandbox & Validation Tooling' (Protocol in workflow.md) 6882aaf

## Phase 3: Feedback Loop Integration [checkpoint: ee0fae1]
- [x] Task: Write tests to ensure validation failures (from Hadolint/Docker) are correctly formatted for agent consumption. 428ff00
- [x] Task: Update the agent's feedback logic to present syntax errors back to the LLM for iterative correction. ed28e2c
- [x] Task: Verify the agent can successfully recover from a self-introduced Dockerfile syntax error in a simulated environment. 5b28348
- [x] Task: Conductor - User Manual Verification 'Feedback Loop Integration' (Protocol in workflow.md) ee0fae1

## Phase 4: Integration & Regression Testing
- [x] Task: Create an integration test suite using a mock failing Dockerfile (similar to the modporter-ai failure). 35bdcd0
- [x] Task: Verify the agent fixes the Dockerfile without introducing new syntax errors. 35bdcd0
- [x] Task: Perform a final end-to-end check of the entire Dockerfile repair flow. 35bdcd0
- [ ] Task: Conductor - User Manual Verification 'Integration & Regression Testing' (Protocol in workflow.md)
