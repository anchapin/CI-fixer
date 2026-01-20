# Research Review: Automated Bug Fixing & Multi-Agent Systems (Jan 2026)

This document summarizes the latest research from arXiv (January 2026) relevant to CI-Fixer's mission of autonomous CI failure diagnosis and repair.

## 1. Repository Intelligence Graph (RIG)
**Paper:** *Repository Intelligence Graph: Deterministic Architectural Map for LLM Code Assistants* (arXiv:2601.10112)
**Authors:** Tsvi Cherny-Shahar, Amiram Yehudai

### Summary
The authors introduce **RIG**, a deterministic graph that maps buildable components, aggregators, runners, tests, and external packages. Unlike simple AST analysis, RIG focuses on the *build and test* structure.
*   **Key Finding:** Providing RIG to agents (Claude, Cursor, Codex) improved accuracy by **12.2%** and reduced completion time by **53.9%**.
*   **Relevance:** High. CI-Fixer currently uses AST-based analysis (`Context Engine`). However, CI failures are often about the *relationship* between a workflow file, a build script, and the underlying code/test.

### Recommendation for CI-Fixer
*   **Enhance Analysis Node:** Upgrade the `Analysis` node to construct a "mini-RIG". It should explicitly map:
    *   GitHub Actions Workflow (`.yml`) ->
    *   Build Command (e.g., `npm run build`) ->
    *   Config File (`package.json`) ->
    *   Entry Point (`src/index.ts`)
*   **Action:** Create a new tool or method in `agent/` that extracts this build-dependency graph and provides it as context to the `Planning` node.

## 2. ABC-Bench: Holistic Backend Evaluation
**Paper:** *ABC-Bench: Benchmarking Agentic Backend Coding in Real-World Development* (arXiv:2601.11077)
**Authors:** Jie Yang et al.

### Summary
Criticizes current benchmarks for focusing on static code logic. Introduces **ABC-Bench** for "holistic" tasks: repository exploration, environment configuration (Docker), service deployment, and passing end-to-end API tests.
*   **Key Finding:** SOTA models struggle significantly with these full-lifecycle tasks compared to isolated code generation.
*   **Relevance:** Critical. CI-Fixer *is* a holistic agent. It runs in Docker, fixes CI (environment + code), and verifies via tests.

### Recommendation for CI-Fixer
*   **Benchmark Alignment:** We should review the 224 tasks in ABC-Bench and see if we can adapt some as integration tests for CI-Fixer itself.
*   **Containerization Focus:** The paper highlights that agents fail at "instantiating containerized services". We should ensure our `Execution` node has robust error handling for Docker/sandbox startup failures, which is often where CI fixes fail.

## 3. Exposure Bias in Bug Fixing
**Paper:** *Model See, Model Do? Exposure-Aware Evaluation of Bug-vs-Fix Preference in Code LLMs* (arXiv:2601.10496)
**Authors:** Ali Al-Kaswan et al.

### Summary
Investigates if LLMs prefer buggy code because they saw it during training.
*   **Key Finding:** Models reproduce buggy lines far more often than fixes if they were exposed to the bug during training. Metrics like "token probability" might misleadingly favor the buggy version.
*   **Relevance:** CI-Fixer might "fix" code by reverting it to a common buggy pattern if the LLM is biased.

### Recommendation for CI-Fixer
*   **Verification Strategy:** In the `Verification` node, do not rely solely on the LLM saying "this looks correct".
*   **Anti-Pattern check:** explicit "Anti-Pattern" check step where the agent is asked: "Does this fix introduce a common error pattern?"
*   **Test-Driven:** Reinforces the need for *execution-based* verification (which CI-Fixer does) rather than just static analysis.

## 4. SAGE & Tool-Augmented Strategies
**Paper:** *SAGE: Tool-Augmented LLM Task Solving Strategies in Scalable Multi-Agent Environments* (arXiv:2601.09750)
**Authors:** Robert K. Strehlow et al.

### Summary
Presents **SAGE**, a framework for tool discovery and execution. It evaluates different "Task Solving Strategies" (TSS)—combinations of prompting methods and agent roles.
*   **Relevance:** CI-Fixer uses a similar multi-agent graph.
*   **Recommendation:** Review SAGE's "strategies" for dynamic tool selection. If CI-Fixer's list of tools grows, we might need a "Tool Selector" node (like SAGE) rather than giving all tools to the `Planning` node.

## 5. Agentic Systems Overview
**Paper:** *LLM-Based Agentic Systems for Software Engineering: Challenges and Opportunities* (arXiv:2601.09822)
**Authors:** Yongjian Tang, Thomas Runkler

### Summary
A survey of the field. Highlights "Multi-agent orchestration" and "Human-agent coordination" as key challenges.
*   **Recommendation:** CI-Fixer's "Human-in-the-loop" (approving the PR) is a good start. The paper suggests "collaborative" modes where the human can refine the plan *during* execution. We could add a "Pause for Feedback" state in CI-Fixer's graph.

---

## Proposed Roadmap Integration

1.  **Immediate (vNext):** Implement "RIG-Lite" in the `Analysis` phase to better understand build failures.
2.  **Short-term:** Add an "Anti-Pattern" self-reflection step in the `Verification` node (inspired by *Model See, Model Do*).
3.  **Long-term:** Adopt ABC-Bench tasks for our own internal regression testing.
