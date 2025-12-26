# Plan: Path Hallucination & Logic Loop Mitigation

This plan implements a Tool Execution Pre-processor to detect path hallucinations, provide automated directory discovery, and mitigate logic loops via fuzzy search and strategy shifts.

## Phase 1: Infrastructure & Loop Detection Core [checkpoint: 52d7200]
Focus on the tracking mechanism and the base middleware structure.

- [x] Task: Create `LoopDetector` service to track hallucination counts per session. c734ca7
- [x] Task: Implement `PathValidator` utility to find the "closest existing parent" of a hallucinated path. b95cd35
- [x] Task: Write unit tests for `LoopDetector` and `PathValidator`. e8380b9
- [x] Task: Conductor - User Manual Verification 'Infrastructure & Loop Detection Core' (Protocol in workflow.md) 52d7200

## Phase 2: Tool Pre-processor & Discovery [checkpoint: dd99a67]
Integrate the validation into the tool execution flow.

- [x] Task: Implement middleware in `ActionLibrary` or tool executor to intercept file-system calls. dd99a67
- [x] Task: Integrate `Fuse.js` for fuzzy path matching on hallucinated targets. dd99a67
- [x] Task: Implement automated `ls` capture for parent directories of missing paths. dd99a67
- [x] Task: Write integration tests for the pre-processor intercepting a `read_file` call. dd99a67
- [x] Task: Conductor - User Manual Verification 'Tool Pre-processor & Discovery' (Protocol in workflow.md) dd99a67

## Phase 3: Mitigation & Strategy Shift [checkpoint: c432764]
Implement the logic to force the agent out of the loop.

- [x] Task: Create a "Strategy Shift" prompt injector that triggers after 2 hallucinations. c432764
- [x] Task: Enhance error messages to return structured `PATH_NOT_FOUND` data. dd99a67
- [x] Task: Write tests simulating 2+ failures and verifying the prompt injection. c432764
- [x] Task: Conductor - User Manual Verification 'Mitigation & Strategy Shift' (Protocol in workflow.md) c432764

## Phase 4: Integration & Verification [checkpoint: 4ce8b28]
Ensure CrimsonArchitect and CyberSentinel use the new protections.

- [x] Task: Verify end-to-end flow with a simulated hallucination scenario (e.g., the `test_cache_simple.py` case). 4ce8b28
- [x] Task: Ensure coverage for the new modules meets the >80% requirement. 4ce8b28
- [x] Task: Conductor - User Manual Verification 'Integration & Verification' (Protocol in workflow.md) 4ce8b28
