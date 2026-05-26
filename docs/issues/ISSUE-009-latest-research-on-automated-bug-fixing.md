# ISSUE-009: Incorporate Latest Research on Automated Bug Fixing and Multi-Agent Systems

## Background

Recent research (May 2026) in the field of automated software engineering highlights several advancements in automated bug fixing, Multi-Agent Systems (MAS), and LLM-based coding agents. As CI-Fixer evolves to handle more complex, real-world CI failures, we need to incorporate these architectural patterns to improve our success rates and reliability.

## Research Findings & Architectural Proposals

Based on recent literature (e.g., from arXiv), the following concepts should be integrated into the CI-Fixer architecture:

1. **Context-Aware Bug Localization (CABL)**
   * **Concept:** Moving beyond simple trace analysis, recent papers suggest using a multi-agent debate to narrow down the precise location of bugs within large repositories before attempting any fixes.
   * **Application:** Introduce a specialized Localization Agent in the `DecompositionNode` that specifically targets file and function-level fault localization using repository-wide context.

2. **Self-Reflective Repair Agents (SR-Repair)**
   * **Concept:** Agents that can evaluate their own generated patches against hidden tests or executable specifications to prevent regressions.
   * **Application:** Enhance the `VerificationNode` to not only run the failing CI test but also generate and run additional peripheral tests to ensure the patch doesn't introduce new side effects.

3. **Hierarchical Multi-Agent Coordination (HMAC)**
   * **Concept:** Using a hierarchical structure where a "Lead Agent" synthesizes the outputs of multiple "Specialist Agents" (e.g., Syntax Specialist, Logic Specialist, Test Specialist).
   * **Application:** Refactor our Coordinator graph to support dynamic spawning of specialist sub-agents based on the error classification (e.g., spawning a `TypeScriptSpecialist` for TS-specific build errors).

4. **Iterative Failure Pattern Learning (IFPL)**
   * **Concept:** Dynamically updating a vector database with not just successful fixes, but the *trajectories* of failed attempts to teach the agent what *not* to do.
   * **Application:** Expand our Knowledge Base service to store execution traces and intermediate failures, allowing the `PlanningNode` to explicitly avoid known dead-end strategies for similar errors.

## Proposed Action Items

- [ ] Create an epic in the project tracker for "Advanced Agentic Bug Fixing Patterns".
- [ ] Implement the Localization Agent logic in `agent/graph/`.
- [ ] Update the `VerificationNode` to support generative peripheral testing.
- [ ] Extend the Prisma schema (`db/schema.prisma`) to support execution trace storage in the Knowledge Base.

## References
- Review of 2024-2026 arXiv papers on "automated bug fixing" and "multi-agent software engineering".
