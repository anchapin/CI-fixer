# Research Summary: Automated Repair and Multi-Agent Systems (Feb 2025)

This document summarizes recent research advancements relevant to the CI-Fixer project, focusing on automated program repair, multi-agent architectures, and reinforcement learning for software engineering.

## 1. SWE-RL: Reinforcement Learning on Software Evolution Data

**Paper:** *SWE-RL: Advancing LLM Reasoning via Reinforcement Learning on Open Software Evolution* (2025)
**Key Insight:** Instead of relying on expensive online simulation (executing code in a sandbox during training), SWE-RL leverages historical software evolution data (GitHub issues, PRs, code changes) to train models. It uses lightweight rule-based rewards (e.g., similarity to ground-truth patches) to guide the model.
**Relevance to CI-Fixer:**
-   **Knowledge Base Enhancement:** CI-Fixer already has a "Knowledge Base" that learns from historical data. SWE-RL suggests a formal methodology for training or fine-tuning the underlying models using this data, rather than just RAG retrieval.
-   **Offline RL:** We can implement an offline RL loop where successful fixes from historical runs (or imported GitHub data) are used to improve the agent's decision-making policy without needing constant live execution feedback during the training phase.

## 2. Blackboard Architecture for Multi-Agent Systems

**Concept:** A shared "Blackboard" where multiple specialized agents (Knowledge Sources) read and write information, coordinated by a control shell.
**Paper:** *Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture* (Han et al., 2025) & *Flock Framework*
**Key Insight:** Traditional multi-agent systems often use rigid point-to-point communication or a central orchestrator with hardcoded flows. A blackboard architecture allows for:
-   **Decoupled Agents:** Agents don't need to know about each other, only about the blackboard schema.
-   **Dynamic Orchestration:** Agents can self-activate based on the state of the blackboard (e.g., "Analysis" agent sees a new error log and posts a diagnosis; "Plan" agent sees a diagnosis and posts a plan).
-   **Scalability:** Easier to add new specialized agents (e.g., a "Security Auditor" or "Performance Optimizer") without rewriting the orchestration logic.
**Relevance to CI-Fixer:**
-   **Refactoring Coordinator:** The current `coordinator.ts` implements a state machine. Transitioning to a blackboard model would allow for more flexible workflows (e.g., parallel analysis, multiple verification strategies).
-   **Event-Driven:** The system could become more event-driven, where `log` events trigger `analysis` agents, and `plan` events trigger `execution` agents.

## 3. Kimi-Dev: Skill-Based Training

**Paper:** *Kimi-Dev: Agentless Training as Skill Prior for SWE-Agents*
**Key Insight:** Training specialized "narrow" skills (e.g., bug reproduction, test writing, code modification) with dense feedback before composing them into a full autonomous agent.
**Relevance to CI-Fixer:**
-   **Node Specialization:** CI-Fixer's graph nodes (Analysis, Decomposition, Planning, Execution) map directly to these skills.
-   **Targeted Improvement:** Instead of trying to improve the "whole agent" at once, we can focus on benchmarking and improving individual nodes (e.g., measuring the success rate of the `Reproduction` node in isolation).

## 4. Code World Model (CWM)

**Paper:** *Code World Model (Meta)*
**Key Insight:** Injecting execution traces and runtime state into the model's input during training/inference, so the model understands not just the static code but its dynamic behavior.
**Relevance to CI-Fixer:**
-   **Context Enrichment:** CI-Fixer gathers logs, but explicitly modeling "execution traces" (e.g., variable states, function call graphs during failure) and feeding them into the context window could significantly improve the `Analysis` node's accuracy.

## 5. Other Notable Mentions

-   **RePair / SecRepair (2024):** Specialized models for program repair and security patching. Suggests the value of domain-specific fine-tuning.
-   **Survey of LLM-based APR (2025):** Highlights the trend towards "conversational" repair (iterative refinement) which CI-Fixer already employs, but reinforces the need for robust *test generation* as a critical component of the repair loop.

---

## Strategic Recommendations for CI-Fixer

1.  **Adopt Blackboard Pattern:** Gradually refactor `agent/graph/coordinator.ts` to a blackboard-style event bus to allow for more dynamic agent interactions.
2.  **Implement Offline RL:** Create a pipeline to export successful fix trajectories from the database and use them to fine-tune a small, specialized model (or prompt-tune the existing LLM) using the SWE-RL approach.
3.  **Skill-Specific Benchmarks:** Expand the `benchmarks/` directory to include isolated tests for "Reproduction", "Analysis", and "Planning" capabilities, not just end-to-end fix rates.
