# Specification: Infer Reproduction Commands from GitHub Workflows

## Goal
Improve the success rate of reproduction by extracting the exact command that failed in CI from the relevant GitHub Actions workflow file.

## Background
Currently, the `ReproductionInferenceService` uses generic strategies (signatures, build tools, safe scanning) or a broad search of all workflows. This often leads to:
1. Inferring a valid but irrelevant command (e.g., running all tests when only a subset failed).
2. Failing to infer a command, leading the agent to create dummy test files that don't reproduce the issue.

The agent logs often show: `[WARN] [Inference] Could not infer reproduction command.`.

## Requirements
1. **Targeted Workflow Parsing**: The service must be able to use the `WorkflowRun` information (specifically the `path` to the `.yml` file) to narrow down its search.
2. **Step-Level Identification**: Identify the specific job or step that failed and extract its `run` command.
3. **Enhanced Robustness**: Handle multi-line `run` commands and environment variables defined in the workflow.
4. **Fallback mechanism**: If no specific workflow is provided, it should still perform its current generic inference but with improved workflow scanning (e.g., checking for 'test' jobs).

## Technical Implementation
- Update `ReproductionInferenceService` to leverage information about the failing workflow run.
- Enhance `inferFromWorkflows` to prioritize the workflow file that actually failed in CI.
- Use LLM-based parsing if heuristics fail to pinpoint the exact failing command within a workflow file.
