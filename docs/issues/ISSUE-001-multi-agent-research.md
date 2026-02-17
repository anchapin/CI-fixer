# Research Issue: Multi-Agent Patterns for CI-Fixer Enhancement

**Status:** Proposed
**Date:** 2024-05-20
**Source:** [LLM-Based Multi-Agent Systems for Software Engineering (He et al., 2024)](https://arxiv.org/abs/2404.04834)

## Abstract
This issue tracks the integration of advanced multi-agent patterns identified in recent academic literature to enhance CI-Fixer's autonomous debugging capabilities. Specifically, we aim to adopt strategies from **AgentFL** (Fault Localization), **FixAgent** (Collaborative Debugging), and **Iterative Experience Refinement (IER)**.

## Key Research Findings & Proposals

### 1. Multi-Stage Fault Localization (Inspired by AgentFL)
**Concept:** Break down fault localization into distinct phases handled by specialized agents rather than a single pass.
- **Comprehension Agent:** Identifies potential fault areas based on logs and stack traces.
- **Navigation Agent:** Narrows down the search within the codebase (using AST or dependency graphs).
- **Confirmation Agent:** Uses debugging tools (e.g., adding logs, running reproduction scripts) to validate the fault location.

**Relevance to CI-Fixer:**
Currently, CI-Fixer's `AnalysisNode` combines diagnosis and localization. Splitting this into a multi-step process could improve accuracy for complex failures where the error log is ambiguous.

### 2. Collaborative Debugging (Inspired by FixAgent)
**Concept:** A "Debugging Agent" and a "Repair Agent" work in a tight feedback loop.
- The **Debugging Agent** analyzes errors and articulates its thought process.
- The **Repair Agent** proposes a fix.
- Crucially, the system refines fault localization by incorporating *repair feedback*—if a fix fails, that information is used to re-localize the fault, not just retry the fix.

**Relevance to CI-Fixer:**
Our current `ExecutionNode` and `VerificationNode` loop is similar, but we could explicitly model the "Repair Feedback" to update the *Diagnosis* state in the Knowledge Graph, rather than just iterating on the patch.

### 3. Iterative Experience Refinement (IER)
**Concept:** Agents continuously adapt by acquiring, utilizing, and selectively refining experiences from previous tasks.
- Instead of just static RAG (Retrieval-Augmented Generation), the agent actively refines its "experience" (heuristics) based on success/failure of previous runs.

**Relevance to CI-Fixer:**
CI-Fixer already has a `KnowledgeBase` and `ErrorFact` system. We should enhance this to store "negative experiences" (what didn't work) and "refined heuristics" (why it didn't work) to prevent the agent from repeating the same ineffective strategies across different run groups.

## Implementation Roadmap

1.  **Refactor Analysis Node:** Split into `Comprehension` and `Localization` sub-steps.
2.  **Enhance Feedback Loop:** Ensure verification failures explicitly update the `ErrorFact` confidence scores in the DB.
3.  **Experience Memory:** Add a `refined_heuristics` field to the `ErrorFact` schema to store IER data.

## References
- He, J., et al. (2024). *LLM-Based Multi-Agent Systems for Software Engineering: Literature Review, Vision and the Road Ahead*. arXiv:2404.04834.
- Qin, Y., et al. (2024). *AgentFL: Scaling LLM-based Fault Localization to Project-Level Context*.
- Lee, C., et al. (2024). *FixAgent: A Unified Debugging Approach via LLM-Based Multi-Agent Synergy*.
