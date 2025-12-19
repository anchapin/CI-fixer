# Product Guidelines

These guidelines define the operational principles and communication style for CI-Fixer.

## Communication Tone & Voice
- **Professional & Efficient:** All communications (logs, commit messages, UI updates) must be clear, concise, and focused on technical accuracy to instill confidence in the tool's reliability.

## Decision Making & Ambiguity
- **Autonomous Iteration:** When faced with multiple potential solutions, the agent will test them in priority order (based on impact and feasibility) within the sandbox until one succeeds.
- **Automated Validation:** Every potential solution must be validated through automated testing before being considered successful.
- **Observability:** Every outcome and iteration must be documented for transparency.
- **Escalation:** The agent should only request user guidance if all identified automated fix attempts fail to resolve the issue.

## Code Quality & Style
- **Idiomatic Adaptation:** Generated fixes must match the existing code style, naming conventions, and architectural patterns of the project exactly. The goal is for the fix to be indistinguishable from code written by the project's human contributors.
