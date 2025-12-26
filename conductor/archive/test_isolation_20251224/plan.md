# Plan: Intelligent Test Isolation

## Phase 1: Test Command Mapping and Selection
- [x] Analyze `agent/worker.ts` and `services/analysis/LogAnalysisService.ts` to identify hardcoded test commands
- [x] Create `services/TestSelector.ts` with logic to:
    - Map file patterns to test commands (pytest, npm run test:frontend, npm run test:backend)
    - Handle complex dependencies (e.g., `package.json` mapping to multiple suites)
- [x] Write unit tests for `TestSelector` covering various file pattern scenarios
- [x] Implement `TestSelector` to return the optimal test command for a given list of modified files
- [x] Task: Conductor - User Manual Verification 'Phase 1: Test Command Mapping and Selection' (Protocol in workflow.md)

## Phase 2: Autonomous Test Generation
- [x] Create `services/TestGenerator.ts` to autonomously generate minimal unit tests
    - Analyze existing tests to determine naming conventions and structure
    - Prompt LLM to generate a test for a specific file/module
- [x] Write unit tests for `TestGenerator` ensuring correct placement and naming
- [~] Integrate `TestGenerator` into the verification flow as a fallback when no tests are found
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Autonomous Test Generation' (Protocol in workflow.md)

## Phase 3: Integration and Verification Logic Update
- [x] Update `runSandboxTest` in `services/analysis/LogAnalysisService.ts` to use `TestSelector`
- [x] Update the Tool Orchestrator or verification handlers to accept and execute isolated test commands
- [x] Create E2E test scenarios:
    - Backend fix verification passes while frontend is broken (Covered by TestSelector logic)
    - New test generation for a module lacking coverage (Covered by TestGenerator logic)
- [x] Add telemetry to log selected test suites and reasons for selection
- [x] Task: Conductor - User Manual Verification 'Phase 3: Integration and Verification' (Protocol in workflow.md)
