# CI-Fixer Research Roadmap: Integrating Latest Agentic APR Findings

**Date:** October 2025
**Status:** Draft / Proposed

## 1. Executive Summary

This document summarizes recent research (2024-2025) in Automated Program Repair (APR) and Multi-Agent Systems, and proposes a roadmap to integrate these findings into CI-Fixer. The goal is to evolve CI-Fixer from a reactive repair agent into a proactive, explanatory, and highly efficient autonomous software engineer.

Key themes from the research include:
*   **Structural Awareness:** Moving beyond file-based retrieval to AST-based and symbol-based navigation (AutoCodeRover).
*   **Symbolic Explanations:** Generating executable explanations (Property-Based Tests) to verify bugs and patches (AutoCodeSherpa).
*   **Guided Autonomy:** Using Finite State Machines (FSMs) and trajectory analysis to guide agents and prune unproductive paths (RepairAgent, Passerine).
*   **Role-Based Decomposition:** Mimicking agile team structures (ALMAS) for complex tasks.

## 2. Key Research Findings

### 2.1. AutoCodeRover: Program Structure Aware Search
*   **Paper:** *AutoCodeRover: Autonomous Program Improvement* (arXiv:2404.05427)
*   **Insight:** Treating codebase navigation as a graph traversal over Abstract Syntax Trees (AST) (Classes, Methods) rather than string matching or file retrieval significantly improves localization.
*   **Relevance:** CI-Fixer's "Context Engine" can be upgraded to support iterative, stratified search (e.g., search class -> get methods -> search method body) to reduce context window pollution.

### 2.2. AutoCodeSherpa: Symbolic Explanations
*   **Paper:** *AutoCodeSherpa: Symbolic Explanations in AI Coding Agents* (arXiv:2507.22414)
*   **Insight:** Generating "Input Conditions" (preconditions), "Infection Conditions" (intermediate bad states), and "Output Conditions" (symptoms) in the form of Property-Based Tests (PBT) helps valid patches and builds user trust.
*   **Relevance:** Adding an "Explanation Node" to CI-Fixer that attempts to generate a standalone reproduction script or PBT before fixing would drastically improve verification.

### 2.3. RepairAgent: Finite State Machine Guidance
*   **Paper:** *RepairAgent: An Autonomous, LLM-Based Agent for Program Repair* (arXiv:2403.17134)
*   **Insight:** Unconstrained agents often loop or get lost. Using a high-level Finite State Machine (FSM) (e.g., `Understand` -> `Collect Info` -> `Hypothesize` -> `Fix`) guides the agent effectively.
*   **Relevance:** CI-Fixer's graph architecture can be formalized into an FSM to prevent "stuck" states and force phase transitions.

### 2.4. Passerine: Trajectory Analysis & Smells
*   **Paper:** *Evaluating Agent-based Program Repair at Google* (arXiv:2501.07531)
*   **Insight:** Analyzing agent execution traces for "smells" (e.g., consecutive searches without reading, repeated edits to the same file) can identify degenerate trajectories early.
*   **Relevance:** Implementing a "Watchdog" or "Supervisor" node in CI-Fixer to kill or redirect unproductive agent threads.

### 2.5. ALMAS: Meta-RAG & Agile Roles
*   **Paper:** *ALMAS: an Autonomous LLM-based Multi-Agent Software Engineering Framework* (arXiv:2510.03463)
*   **Insight:** Pre-computing summaries of all files/functions ("Meta-RAG") allows for cheap, high-level planning before diving into code.
*   **Relevance:** Enhancing CI-Fixer's Knowledge Base to maintain a "Summary Map" of the repo for quick routing.

## 3. Proposed Roadmap

### Phase 1: Guided Autonomy (The "Brain" Upgrade)
*   **Objective:** Reduce loops and wasted tokens.
*   **Actions:**
    1.  **FSM Implementation:** Enforce a strict state transition model in the Coordinator (e.g., `Analysis` -> `Reproduction` -> `Localization` -> `Fix` -> `Verify`).
    2.  **Trajectory Watchdog:** Implement heuristics to detect "thrashing" (e.g., if search yields 0 results 3x in a row, switch strategy or ask user).
    3.  **Prompt Dynamics:** Update system prompts dynamically based on the current FSM state (e.g., in `Fix` state, hide `Search` tools to force focus).

### Phase 2: Structural Context (The "Eyes" Upgrade)
*   **Objective:** Improve localization accuracy.
*   **Actions:**
    1.  **Iterative AST Search:** Implement `search_class`, `search_method`, `get_callers` tools that return *signatures* first, then allow drilling down.
    2.  **Meta-Summarization:** Create a lightweight index of the repo (file purposes, key classes) to aid the initial routing decision.

### Phase 3: Symbolic Verification (The "Trust" Upgrade)
*   **Objective:** Verify fixes without relying solely on existing tests.
*   **Actions:**
    1.  **Reproduction Agent:** A specialized node dedicated to generating a minimal reproduction script (shell or python) that fails on the current code.
    2.  **Explanation Generation:** Try to output a "Root Cause Analysis" markdown artifact that defines the Input/Infection/Output conditions.

### Phase 4: Multi-Agent Specialization
*   **Objective:** Parallelize work.
*   **Actions:**
    1.  **Role Separation:** Split the core loop into distinct specialized agents (e.g., a "QA Agent" that only writes tests, a "Developer Agent" that only writes code).
    2.  **Async Execution:** Allow the QA Agent to work on a reproduction case while the Analyst is still mapping the codebase.

## 4. Immediate Next Steps
1.  Refactor `agent/` to support FSM-based state transitions.
2.  Prototype the `AutoCodeRover` style iterative search tools in `ai-engine/`.
3.  Create a benchmark suite (based on `Passerine` findings) to measure "trajectory efficiency".
