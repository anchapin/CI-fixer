# Plan: Adaptive Sandbox Tooling & Infrastructure Detection

## Phase 1: Error Classification & Infrastructure Detection [checkpoint: 23e7c2e]
- [x] Task: Update `types.ts` to include infrastructure-specific error categories and execution statuses (e.g., `INFRASTRUCTURE_ERROR`). 1965b62
- [x] Task: Enhance `errorClassification.ts` to distinguish between logic failures (exit code 1) and infrastructure failures (exit code 127/command not found) using regex on stderr. ce4c6c8
- [x] Task: Write unit tests in `__tests__/unit/errorClassification.test.ts` to verify correct categorization of "command not found" errors. 0435069
- [x] Task: Conductor - User Manual Verification 'Phase 1: Error Classification' (Protocol in workflow.md)

## Phase 2: Capability Probing & Manifest Mapping [checkpoint: b7a42e4]
- [x] Task: Create `services/sandbox/CapabilityProbe.ts` to implement the "Initial Capability Probe" (`tool --version`). 8b0229e
- [x] Task: Implement mapping logic to cross-reference `package.json` and `requirements.txt` with required binaries (e.g., `vitest`, `pytest`). bece730
- [x] Task: Write tests to ensure the probe correctly identifies missing binaries based on project files. bece730
- [x] Task: Conductor - User Manual Verification 'Phase 2: Capability Probing' (Protocol in workflow.md)

## Phase 3: Autonomous Provisioning & Path Management
- [ ] Task: Implement `services/sandbox/ProvisioningService.ts` with logic to install missing tools (e.g., `npm install -g`, `pip install`).
- [ ] Task: Implement dynamic PATH refreshing to ensure newly installed tools are visible to the current execution context.
- [ ] Task: Add "Installation Loop Prevention" logic to cap retry attempts for tool provisioning.
- [ ] Task: Write tests for the provisioning flow, mocking package manager success/failure.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Autonomous Provisioning' (Protocol in workflow.md)

## Phase 4: Integration & Agent Workflow Update
- [ ] Task: Integrate `CapabilityProbe` and `ProvisioningService` into the main sandbox execution loop in `services/sandbox/`.
- [ ] Task: Update the agent's feedback loop (likely in `agent/worker.ts` or `services/repair-agent/`) to report "Environment Setup" status instead of "Fix Failed" when provisioning.
- [ ] Task: Perform end-to-end verification using a mock CI failure that requires a missing tool.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Integration' (Protocol in workflow.md)
