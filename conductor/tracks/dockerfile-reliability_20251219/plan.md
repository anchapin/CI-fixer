# Plan: Enhanced Dockerfile Repair Reliability

## Phase 1: Knowledge & Prompting Improvements
- [x] Task: Update `prompts/execution/code-fix-v1.md` to include explicit Dockerfile syntax rules (no inline comments in RUN, flag accuracy). 1a7aa45
- [x] Task: Create `runbooks/docker/syntax-errors.md` documenting common pitfalls (typos, comment errors) and their solutions. 1a7aa45
- [x] Task: Write unit tests for `services/repair-agent/patch-generation.ts` to verify Dockerfile constraint enforcement. d10e9bd
- [x] Task: Implement Dockerfile-specific logic in `services/repair-agent/patch-generation.ts` to avoid known bad patterns. d10e9bd
- [ ] Task: Conductor - User Manual Verification 'Knowledge & Prompting Improvements' (Protocol in workflow.md)

## Phase 2: Sandbox & Validation Tooling
- [ ] Task: Update `services/sandbox/SandboxService.ts` to ensure `hadolint` is installed during sandbox initialization.
- [ ] Task: Write unit tests for a new `DockerfileValidator` service or utility.
- [ ] Task: Implement `DockerfileValidator` that executes `hadolint` and `docker build` (parsability check).
- [ ] Task: Integrate `DockerfileValidator` into the agent's verification workflow (likely in `services/repair-agent/` or a graph node).
- [ ] Task: Conductor - User Manual Verification 'Sandbox & Validation Tooling' (Protocol in workflow.md)

## Phase 3: Feedback Loop Integration
- [ ] Task: Write tests to ensure validation failures (from Hadolint/Docker) are correctly formatted for agent consumption.
- [ ] Task: Update the agent's feedback logic to present syntax errors back to the LLM for iterative correction.
- [ ] Task: Verify the agent can successfully recover from a self-introduced Dockerfile syntax error in a simulated environment.
- [ ] Task: Conductor - User Manual Verification 'Feedback Loop Integration' (Protocol in workflow.md)

## Phase 4: Integration & Regression Testing
- [ ] Task: Create an integration test suite using a mock failing Dockerfile (similar to the modporter-ai failure).
- [ ] Task: Verify the agent fixes the Dockerfile without introducing new syntax errors.
- [ ] Task: Perform a final end-to-end check of the entire Dockerfile repair flow.
- [ ] Task: Conductor - User Manual Verification 'Integration & Regression Testing' (Protocol in workflow.md)
