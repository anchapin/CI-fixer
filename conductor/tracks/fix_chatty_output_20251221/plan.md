# Plan: Fix Chatty Output Injection

## Phase 1: Infrastructure and Reproduction [checkpoint: bd71d61]
- [x] Task: Create a reproduction unit test for "Chatty Output" in `write_file` and `replace` tools.
- [x] Task: Implement a robust `extractCodeBlock` utility function to isolate content within triple backticks. (dd93675)
- [ ] Task: Conductor - User Manual Verification 'Infrastructure and Reproduction' (Protocol in workflow.md)

## Phase 2: Prompt Engineering & Core Enforcement [checkpoint: e14e963]
- [x] Task: Update system prompts in `prompts/execution/` to explicitly forbid conversational filler in tool calls. (4a91122)
- [x] Task: Integrate `extractCodeBlock` into `services/action-library.ts` to sanitize file-writing inputs. (c4a593d)
- [ ] Task: Conductor - User Manual Verification 'Prompt Engineering & Core Enforcement' (Protocol in workflow.md)

## Phase 3: Retry Logic & Service Integration
- [ ] Task: Implement "Fail-Fast & Retry" logic in `services/repair-agent/patch-generation.ts` when no backticks are detected.
- [ ] Task: Add validation hooks in the core LLM layer (`services/analysis/llm/`) to prevent leaking conversational text into structured payloads.
- [ ] Task: Conductor - User Manual Verification 'Retry Logic & Service Integration' (Protocol in workflow.md)

## Phase 4: Verification and Documentation
- [ ] Task: Run full integration tests simulating the `requirements.txt` failure scenario to verify the fix.
- [ ] Task: Perform a final pass on code coverage and quality gates for the newly added parsing logic.
- [ ] Task: Conductor - User Manual Verification 'Verification and Documentation' (Protocol in workflow.md)
