# Track Plan: Establish Core Reliability & Quality Standards

## Phase 1: Quality Infrastructure Setup
- [x] Task: Configure Vitest and Playwright a7df476
    - [ ] Subtask: Review and update `vitest.config.ts` to ensure comprehensive coverage collection.
    - [ ] Subtask: Verify `playwright.config.ts` matches the current project structure.
    - [ ] Subtask: Create a `test:ci` script in `package.json` that runs all tests and lints.
- [ ] Task: Enforce Code Style & Linting
    - [ ] Subtask: Update `.eslintrc` (or eslint config) to enforce stricter TypeScript rules (no implicit any).
    - [ ] Subtask: Add `husky` and `lint-staged` (if not present) to enforce pre-commit checks.
- [ ] Task: Conductor - User Manual Verification 'Quality Infrastructure Setup' (Protocol in workflow.md)

## Phase 2: Testing & Refactoring - Core Services
- [ ] Task: Agent Service Refactoring & Testing
    - [ ] Subtask: Write unit tests for `agent/supervisor.ts` and `agent/worker.ts`.
    - [ ] Subtask: Refactor `agent/graph/` nodes to ensure they are pure/testable where possible.
    - [ ] Subtask: Add error boundary checks in the agent execution loop.
- [ ] Task: Backend Services Testing
    - [ ] Subtask: Write integration tests for `services/llm/LLMService.ts` (mocking the API).
    - [ ] Subtask: Write integration tests for `db/client.ts` to verify data persistence.
- [ ] Task: Conductor - User Manual Verification 'Testing & Refactoring - Core Services' (Protocol in workflow.md)

## Phase 3: Benchmarking & Performance
- [ ] Task: Establish Performance Baselines
    - [ ] Subtask: Create a benchmark script `scripts/benchmark-core.ts` that runs a standard set of "fix" simulations.
    - [ ] Subtask: Record initial metrics (Time to Fix, Success Rate) in `BENCHMARKS.md`.
- [ ] Task: Conductor - User Manual Verification 'Benchmarking & Performance' (Protocol in workflow.md)
