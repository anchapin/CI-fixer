# Research Recommendations: 2024-2025 LLM-based Automated Program Repair

## Executive Summary
This document summarizes recent research (2024-2025) in LLM-based Automated Program Repair (APR) and proposes actionable enhancements for the CI-Fixer agent. The recommendations are based primarily on the survey "A Survey of LLM-based Automated Program Repair" (arXiv:2506.23749) and related works like "SWE-Search", "Agentless", and "AprMcts".

The key insight is a shift towards **Agentic Frameworks** that utilize **Monte Carlo Tree Search (MCTS)**, **Hierarchical Retrieval**, and **LLM-as-Judge** paradigms to solve complex, repository-level defects.

## Key Findings & Paradigms

### 1. Agentic Frameworks vs. Procedural Pipelines
*   **Procedural Pipelines** (e.g., *Agentless*): High cost-efficiency. They use fixed scripts for retrieval and generation. *Agentless* uses a hierarchical retrieval approach (files -> structures -> code) which is very effective and cheap.
*   **Agentic Frameworks** (e.g., *SWE-Agent*, *AutoCodeRover*): High adaptability. They allow the LLM to choose tools.
*   **Self-Controlled Systems** (e.g., *SWE-Search*): The state-of-the-art. They combine agents with search algorithms like MCTS to explore multiple repair paths and debate candidate patches.

### 2. Retrieval-Augmented Generation (RAG)
*   **Hierarchical Retrieval**: Retrieving file signatures first, then relevant code bodies, is more effective than "embedding-based similarity search" which often misses context or floods the context window.
*   **Knowledge Graphs**: Systems like *KGCompass* build a graph of the repository to better understand dependencies, improving cross-file repair.

### 3. Verification & Evaluation
*   **LLM-as-Judge**: Using a separate "Critic" model to evaluate generated patches *before* execution or as a gatekeeper. This reduces "overfitting to weak tests" (where a patch passes tests but is semantically wrong).
*   **Abstain and Validate**: Policies where the agent can decide *not* to fix a bug if confidence is low, increasing reliability.

## Recommendations for CI-Fixer

Based on the research, the following features should be prioritized for incorporation into CI-Fixer:

### 1. Implement Monte Carlo Tree Search (MCTS) for Planning
*   **Concept**: Instead of a linear "Plan -> Execute" flow, the Planning Node should use MCTS to explore different root cause hypotheses and repair strategies.
*   **Reference**: *SWE-Search* (arXiv:2405.01466 related), *AprMcts* (arXiv:2507.01827).
*   **Action**: Integrate an MCTS loop in the `Planning` node that allows for backtracking if a strategy fails validation.

### 2. Adopt Hierarchical Retrieval (Agentless-style)
*   **Concept**: Reduce context usage and noise by retrieving context in stages:
    1.  List relevant files (based on error logs).
    2.  Retrieve class/function signatures of those files.
    3.  Retrieve full code only for the most relevant sections.
*   **Reference**: *Agentless* (arXiv:2407.01489).
*   **Action**: Refactor the `Analysis` node to output a "Skeleton Context" first, then expand only necessary parts.

### 3. Integrate LLM-as-Judge / Critic Node
*   **Concept**: Add a "Critic" or "Verification" node *before* the actual execution/test run, or as a post-test semantic checker.
*   **Reference**: *TSAPR* (arXiv:2507.01827), *Abstain and Validate* (arXiv:2510.03217).
*   **Action**: Create a new graph node `Critic` that reviews the diff against the original issue description and code style *before* `Verification` runs the tests.

### 4. Enhance Benchmarking
*   **Concept**: Ensure we measure `pass@1` (strict) and `pass@k` (exploration) on standard benchmarks.
*   **Reference**: SWE-bench Verified.
*   **Action**: Continue expanding `BENCHMARKS.md` to include *SWE-bench Verified* cases, as they are cleaner than the full SWE-bench.

### 5. Analysis-Augmented Generation (AAG)
*   **Concept**: Use static analysis tools to guide the LLM.
*   **Reference**: *InferFix*, *TraceFixer*.
*   **Action**: If not already present, add steps to run linters (ESLint, Pylint) or static analyzers (Infer) on the *reproduction* phase to feed precise error locations to the agent.
