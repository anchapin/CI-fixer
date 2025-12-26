# Specification: Inability to Detect "Stuck" Loops (Loop Detection & Mitigation)

## Overview
Currently, the agent can fall into "stuck loops" where it applies the same fix repeatedly (e.g., toggling dependency versions) and receives the same failure output without changing its strategy. This leads to wasted API credits and time. This track implements a `LoopDetector` service to identify these cycles and force a strategy shift.

## Functional Requirements
- **Loop Detection Service:** Create `services/LoopDetector.ts` to track agent states.
- **State Hashing:** Generate a unique hash for each iteration based on:
    - File paths modified.
    - Specific content changes (diff or checksum).
    - Resulting error fingerprint (from logs).
- **History Tracking:** Maintain a history of state hashes within a single agent session.
- **Context Injection:** When a duplicate state hash is detected, inject a `LOOP_DETECTED` flag into the LLM context for the next iteration.
- **Strategy Shift Information:** The injected context must include details of the repeated state and an explicit instruction to avoid the previous action and attempt a different strategy (e.g., fixing a different file or re-diagnosing the logs).

## Non-Functional Requirements
- **Performance:** State hashing and lookup should be fast and not significantly impact iteration time.
- **Persistence:** Loop detection state should persist for the duration of an agent "run" or session.

## Acceptance Criteria
- [ ] A new service `LoopDetector` is implemented and integrated into the agent loop.
- [ ] The agent correctly identifies when it has applied the same change and received the same error.
- [ ] When a loop is detected, the LLM is informed via the prompt context.
- [ ] Unit tests verify that the `LoopDetector` accurately hashes states and detects repetitions.
- [ ] Integration tests show the agent deviating from a loop when the `LOOP_DETECTED` flag is present.

## Out of Scope
- Cross-session loop detection (remembering loops from previous days/weeks).
- Automated rollback of changes when a loop is detected (mitigation is handled via prompt instruction).