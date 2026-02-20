# Issue: Incorporate Advanced Automated Repair Research (Feb 2025)

**Status:** Proposed
**Priority:** High
**Labels:** enhancement, architecture, research

## Summary
Recent research from 2024 and 2025 in automated program repair and multi-agent systems suggests significant opportunities to improve CI-Fixer's architecture and performance. This issue proposes incorporating key findings from papers such as *SWE-RL*, *Blackboard Architecture for LLM Agents*, and *Kimi-Dev*.

## Research Findings
A detailed summary of the research is available in [docs/research/2025-02-automated-repair-advancements.md](../research/2025-02-automated-repair-advancements.md).

Key takeaways:
1.  **SWE-RL (2025):** Use historical software evolution data (GitHub) for offline reinforcement learning instead of just RAG.
2.  **Blackboard Architecture (2025):** Move from a rigid state-machine coordinator to a dynamic, event-driven blackboard system for better multi-agent orchestration.
3.  **Skill-Based Training (Kimi-Dev):** Train and benchmark individual agent nodes (Analysis, Planning) as isolated skills.
4.  **Code World Model:** Incorporate execution traces into the context window.

## Proposed Changes

### 1. Architectural Refactoring: Blackboard Pattern
Refactor the `GraphAgent` coordinator (`agent/graph/coordinator.ts`) to use a Blackboard pattern.
-   **Current:** Central loop iterating through `NODE_MAP`.
-   **Proposed:** A shared `Blackboard` state where specialized agents subscribe to data changes.
    -   Example: `AnalysisAgent` subscribes to `new_log_entry`.
    -   Example: `PlanningAgent` subscribes to `diagnosis_complete`.
-   **Benefit:** Decoupling, parallel execution potential, easier extensibility (e.g., adding a "Security Reviewer" agent without changing the main loop).

### 2. Offline Reinforcement Learning Pipeline (SWE-RL)
Implement a pipeline to leverage our "Knowledge Base" for offline training.
-   **Action:** Create a script to export successful fix trajectories from the database into a format suitable for DPO (Direct Preference Optimization) or similar RL fine-tuning.
-   **Action:** Integrate with the existing `gym/` environment to support replay of historical successes as training episodes.

### 3. Enhanced Context with Execution Traces
Improve the `AnalysisNode` to ingest and process execution traces.
-   **Action:** Update the sandbox execution to capture more granular runtime data (e.g., variable values, stack traces with local context).
-   **Action:** Feed this structured trace data into the LLM context during the Analysis phase.

### 4. Skill-Specific Benchmarks
Expand `benchmarks/` to test components in isolation.
-   **Action:** Create a benchmark suite specifically for the `Reproduction` node (can it reproduce the bug given the logs?).
-   **Action:** Create a benchmark suite for the `Planning` node (can it generate a valid plan given a diagnosis?).

## Acceptance Criteria
- [ ] Research summary document created (Completed).
- [ ] Architecture Design Document (ADD) updated with Blackboard proposal.
- [ ] Prototype of Blackboard-based coordinator created in a feature branch.
- [ ] Script for exporting training data from Knowledge Base created.
- [ ] New benchmark suites for isolated component testing added.
