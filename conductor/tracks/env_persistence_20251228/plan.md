# Plan: Environment State Persistence

## Tasks
- [x] **Analyze Sandbox Execution** [ebcfbef]
    - Examine `sandbox.ts` and `ProvisioningService.ts` to understand how commands are executed (one-off vs. persistent session).
    - Identify why `PATH` updates are being lost.
- [x] **Create Reproduction Case** [ebcfbef]
    - Create a test fixture `__tests__/fixtures/persistence_check` with a `requirements.txt` (or similar) and a script that runs a tool immediately after install.
    - Verify the failure mode (the "Not Found" loop).
- [x] **Implement PATH Persistence / Refresh** [ebcfbef]
    - Modify the `Sandbox` or `ProvisioningService` to ensure `PATH` is updated or profiles are sourced.
    - *Alternative:* Implement a mechanism to chain installation and execution or explicitly export PATH.
- [x] **Implement `python -m` Fallback (Optional/Secondary)** [ebcfbef]
    - Modify the command generation logic to prefer `python -m pytest` over `pytest`.
- [x] **Verify Fix** [ebcfbef]
    - Run the reproduction case and ensure the tool runs successfully.
