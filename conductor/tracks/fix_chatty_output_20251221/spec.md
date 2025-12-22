# Specification: Fix Chatty Output Injection

## Overview
This track addresses a critical bug where conversational filler from the LLM is inadvertently written into files during the execution phase. This currently causes CI failures (e.g., invalid package versions in `requirements.txt`). We will implement a hybrid approach combining stricter prompting and robust output parsing to ensure only valid code/content is extracted and written to disk.

## Functional Requirements
- **Strict Parsing Safety Net:** 
    - Implement a validation layer for tool calls (`write_file`, `replace`).
    - Only content contained within markdown triple backticks (e.g., ```code```) should be accepted as valid file content.
- **Fail-Fast & Retry:** 
    - If the LLM output does not contain markdown code blocks when expected, the system must reject the input.
    - Trigger an automatic retry with a corrective prompt instructing the LLM to wrap code in backticks.
- **Prompt Strengthening:** 
    - Update system prompts in `prompts/execution/` and relevant LLM services to explicitly forbid conversational output within tool-call payloads.
- **Multi-Layer Enforcement:** 
    - Apply these changes across `services/repair-agent/patch-generation.ts`, `services/action-library.ts`, and the core LLM interaction layer in `services/analysis/llm/`.

## Non-Functional Requirements
- **Reliability:** The parsing must handle various markdown flavors (e.g., ```python, ```typescript, or plain ```).
- **Observability:** Log instances where "chatty" output was detected and rejected to monitor model performance.

## Acceptance Criteria
- [ ] Unit tests demonstrate that `write_file` and `replace` tools strip all text outside of triple backticks.
- [ ] Integration tests verify that if an LLM returns a mix of "Sure, here is the file: [CODE]", only [CODE] is written.
- [ ] Automated retry is triggered when code blocks are completely missing from a code-generating response.
- [ ] The reported `requirements.txt` failure scenario is reproduced in a test and fixed.

## Out of Scope
- Modifying the core LLM architecture or switching models.
- Addressing conversational filler in chat-only interfaces (non-tool calls).
