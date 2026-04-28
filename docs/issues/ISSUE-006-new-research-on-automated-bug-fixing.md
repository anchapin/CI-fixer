# ISSUE-006: Incorporate Latest Research on Automated Bug Fixing and Multi-Agent Frameworks

## Overview
Recent research in automated program repair (APR) and multi-agent software engineering frameworks provides novel insights that could significantly enhance CI-Fixer's capabilities. A review of recent papers from arXiv highlights key areas for improvement, particularly around fault localization context, specification guidance, history-based retrieval, and cross-modal failure diagnosis.

## Key Research Findings

1. **Constraint-Guided Multi-Agent Decompilation (MCGD)**
   - *Insight*: Hierarchical validation pipelines (syntactic correctness -> compilability -> behavioral equivalence) improve re-executability and overall accuracy of agentic outputs.
   - *Application*: CI-Fixer should adopt a stricter, multi-layered constraint validation loop within its Verification Agent, ensuring generated patches pass structural, compilation, and test-based constraints before moving forward.

2. **PatchRecall: Patch-Driven Retrieval for Automated Program Repair**
   - *Insight*: Balancing codebase retrieval with history-based retrieval (leveraging similar past issues and their edited files) yields higher recall without noise.
   - *Application*: Enhance CI-Fixer's Context Engine and Knowledge Base by integrating a history-based retrieval mechanism. When a CI failure is encountered, retrieve files modified in historical fixes for similar failures as primary candidates.

3. **Prometheus: Executable Specifications for Automated Program Repair**
   - *Insight*: Explicit requirement intent (Requirement Quality Assurance) prevents agents from over-engineering or hallucinating intents. Generating minimal, precise corrections aligned with executable specifications improves success rates.
   - *Application*: Implement an Intent Analysis node or augment the Planning Agent to explicitly infer and validate the specification or intention of the failing code block before generating fixes.

4. **Fault Localization Context Optimization**
   - *Insight*: More context is not uniformly better. The most effective fault localization strategy combines broad semantic understanding (file-level) with precise line-level localization, while element-level expansion provides mixed results.
   - *Application*: Optimize CI-Fixer's context scoping. Restrict context window bloat by passing only a carefully curated set of files (around 6-10) and utilizing targeted line-level indicators instead of broad element-level AST extractions.

5. **Cross-Modal Failure Diagnosis (CUJBench)**
   - *Insight*: Agents often fail to synthesize browser-visible evidence with backend observability signals. Full-toolset access can induce unfocused exploration.
   - *Application*: For E2E failures, introduce a specialized Cross-Modal Diagnosis Agent or strict diagnostic framing that tightly correlates frontend error snapshots with specific backend logs, limiting unnecessary tool exploration.

## Architectural Recommendations for CI-Fixer

Based on these findings, we propose the following architectural updates to CI-Fixer:

1. **Enhance the Knowledge Base with History-Based Retrieval**: Integrate the `PatchRecall` methodology. Ensure the agent stores not just error fingerprints but the actual files modified in successful resolutions to prioritize them during context extraction.
2. **Implement Hierarchical Validation in the Repair Loop**: Adopt an MCGD-style multi-level constraint check (Syntax -> Build -> Test) within the Verification Node to fail fast and provide structured error feedback to the Repair Node.
3. **Refine Context Window Construction**: Update the AST Context Engine to prioritize a balance of file-level summaries and exact line-level failure context, avoiding the middle-ground element-level noise.
4. **Specification-Guided Planning**: Introduce an explicit step where the Planning Agent defines the expected behavior (postcondition) before attempting a repair, ensuring changes remain minimal and intent-aligned.

## Action Items
- [ ] Implement history-based file retrieval in `services/knowledge-base.ts`.
- [ ] Restructure the Verification Node to use a hierarchical constraint pipeline.
- [ ] Optimize the context extraction payload to adhere to the file+line strategy.
- [ ] Add explicit specification generation to the Planning Agent prompt.