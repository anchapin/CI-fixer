# Plan: Missing Test Runners (Environment Issue)

This plan implements a hybrid solution to resolve missing test runners by updating the base Docker image and enhancing the automated provisioning logic.

## Phase 1: Infrastructure - Enhanced Docker Image [checkpoint: 6b5b4dd]

- [x] Task: Define New Dockerfile Requirements (49880df)
  - Identify the best base image (e.g., a Debian-based image with multi-runtime support).
  - List exact versions for Node.js, Python, Bun, and Go to be pre-installed.
- [x] Task: Implement New Dockerfile (49880df)
  - Create/Update the Dockerfile to include Python (`pytest`, `unittest`, `tox`), JS/TS (`vitest`, `jest`, `mocha`), and all required package managers.
  - Optimize the image size using multi-stage builds or layer cleanup.
- [x] Task: Build and Local Verification (49880df)
  - Build the image locally.
  - Run a smoke test container to verify all runtimes and runners are accessible via CLI.
- [ ] Task: Conductor - User Manual Verification 'Infrastructure - Enhanced Docker Image' (Protocol in workflow.md)

## Phase 2: Logic - Automated On-Demand Provisioning

- [ ] Task: Enhance `ProvisioningService` for Runner Detection
  - Implement a check to verify if a runner exists in the PATH before command execution.
  - Define a mapping of common runners to their installation commands (e.g., `pytest` -> `pip install pytest`).
- [ ] Task: Implement Silent On-Demand Installation
  - Update the provisioning logic to automatically execute the installation command if a runner is missing.
  - Add internal logging for these "silent" installations for auditability.
- [ ] Task: Write Unit Tests for `ProvisioningService`
  - Mock the environment to simulate missing runners.
  - Verify that the service triggers the correct installation command.
- [ ] Task: Conductor - User Manual Verification 'Logic - Automated On-Demand Provisioning' (Protocol in workflow.md)

## Phase 3: Integration & Verification

- [ ] Task: Update Agent Sandbox Configuration
  - Point the sandbox configuration to use the new "thicker" Docker image.
- [ ] Task: Integration Test - Pre-installed Runners
  - Run a test suite that uses `pytest` and `vitest` without any installation steps.
- [ ] Task: Integration Test - On-demand Runners
  - Run a test suite using a runner NOT in the base image (e.g., a specific older version of a tool).
  - Verify the system installs it and then successfully runs the tests.
- [ ] Task: Conductor - User Manual Verification 'Integration & Verification' (Protocol in workflow.md)
