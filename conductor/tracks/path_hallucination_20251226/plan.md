# Plan: Path Hallucination & Logic Loop Mitigation

This plan implements a Tool Execution Pre-processor to detect path hallucinations, provide automated directory discovery, and mitigate logic loops via fuzzy search and strategy shifts.

## Phase 1: Infrastructure & Loop Detection Core
Focus on the tracking mechanism and the base middleware structure.

- [x] Task: Create `LoopDetector` service to track hallucination counts per session. c734ca7
- [x] Task: Implement `PathValidator` utility to find the "closest existing parent" of a hallucinated path. b95cd35
- [ ] Task: Write unit tests for `LoopDetector` and `PathValidator`.
- [ ] Task: Conductor - User Manual Verification 'Infrastructure & Loop Detection Core' (Protocol in workflow.md)

## Phase 2: Tool Pre-processor & Discovery
Integrate the validation into the tool execution flow.

- [ ] Task: Implement middleware in `ActionLibrary` or tool executor to intercept file-system calls.
- [ ] Task: Integrate `Fuse.js` for fuzzy path matching on hallucinated targets.
- [ ] Task: Implement automated `ls` capture for parent directories of missing paths.
- [ ] Task: Write integration tests for the pre-processor intercepting a `read_file` call.
- [ ] Task: Conductor - User Manual Verification 'Tool Pre-processor & Discovery' (Protocol in workflow.md)

## Phase 3: Mitigation & Strategy Shift
Implement the logic to force the agent out of the loop.

- [ ] Task: Create a "Strategy Shift" prompt injector that triggers after 2 hallucinations.
- [ ] Task: Enhance error messages to return structured `PATH_NOT_FOUND` data.
- [ ] Task: Write tests simulating 2+ failures and verifying the prompt injection.
- [ ] Task: Conductor - User Manual Verification 'Mitigation & Strategy Shift' (Protocol in workflow.md)

## Phase 4: Integration & Verification
Ensure CrimsonArchitect and CyberSentinel use the new protections.

- [ ] Task: Verify end-to-end flow with a simulated hallucination scenario (e.g., the `test_cache_simple.py` case).
- [ ] Task: Ensure coverage for the new modules meets the >80% requirement.
- [ ] Task: Conductor - User Manual Verification 'Integration & Verification' (Protocol in workflow.md)
