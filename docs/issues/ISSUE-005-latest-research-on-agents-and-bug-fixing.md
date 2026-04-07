# ISSUE-005: Incorporating Latest Research on Multi-Agent Systems and Automated Bug Fixing

## Overview

A review of recent (2025/2026) research from arXiv on automated bug fixing, multi-agent frameworks, and LLMs has revealed several new strategies and architectural insights that should be incorporated into the CI-Fixer application.

## Key Research Findings

1. **PAFT: Preservation Aware Fine-Tuning for Minimal-Edit Program Repair**
   - **Finding:** Large Language Models (LLMs) often generate "over-edited" patches that pass test suites but rewrite more code than necessary, increasing review costs. Preservation Aware Fine-Tuning (PAFT) derives token-level preservation signals to encourage minimal-edit repairs.
   - **Relevance:** CI-Fixer currently generates fixes which might be excessively large or modify non-faulty code blocks.

2. **Beyond Isolated Tasks: A Framework for Evaluating Coding Agents on Sequential Software Evolution**
   - **Finding:** Evaluating agents on isolated pull requests (PRs) is flawed as it ignores the reality of software development where changes accumulate and technical debt accrues. Real success rates drop significantly when agents are tested on sequential PRs because they leave "spillover" effects of inefficient or buggy code.
   - **Relevance:** CI-Fixer's current benchmark suite measures success on single, isolated failures.

3. **ABTest: Behavior-Driven Testing for AI Coding Agents**
   - **Finding:** Agents are prone to behavioral anomalies under diverse and adversarial scenarios. ABTest presents a framework for behavior-driven fuzzing by turning failure reports into systematic tests of coding agents.
   - **Relevance:** To ensure CI-Fixer operates robustly in complex production repositories, it needs systematic testing of its actions and state transitions.

4. **SkVM: Compiling Skills for Efficient Execution Everywhere**
   - **Finding:** Treating skills simply as raw text context makes them fragile across different agents. Skills should be compiled and treated as reusable, isolated units of execution.
   - **Relevance:** The CI-Fixer tool suite (e.g. `CIFixerTool`) could benefit from stronger encapsulation.

## Proposed Action Items for CI-Fixer

1. **Implement Minimal-Edit Heuristics / Fine-Tuning:**
   - Incorporate preservation-aware prompting or fine-tuning in the Repair Agent to reduce the Average Edit Distance (AED) of proposed fixes.
   - Introduce a post-processing or secondary review step to strip out unnecessary token changes.

2. **Expand Benchmarks to Sequential Software Evolution:**
   - Modify the `benchmarks/` suite to simulate sequential CI failures and measure the agent's ability to maintain repository health over time, not just pass a single test run.
   - Track complexity and technical debt of the generated code over a sequence of fixes.

3. **Incorporate Behavior-Driven Fuzzing:**
   - Integrate a behavior-driven fuzzing framework (similar to ABTest) within the `__tests__/` directory to systematically validate the agent's behaviors across diverse, simulated failures and interaction patterns.

4. **Refactor Tool Architecture:**
   - Evolve the tool orchestration (`services/orchestration/tool-types.ts`) to treat skills as compiled, portable units rather than just raw context injections, improving reliability across different execution backends (E2B vs. Docker).
