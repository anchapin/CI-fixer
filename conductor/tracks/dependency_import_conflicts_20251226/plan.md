# Plan: Dependency & Import Conflicts

## Phase 1: Dependency Conflict Resolution [checkpoint: 3e766bc]
- [x] Task: Identify the file containing the `pyjwt` dependency definition (e.g., `requirements.txt`, `pyproject.toml`). [3a889e7]
- [x] Task: Modify the identified file to change the `pyjwt` requirement to `pyjwt>=2.9.0`. [293d0dc]
- [x] Task: Run the dependency installation command (e.g., `pip install -r requirements.txt`) to verify that the conflict is resolved. [7ce8cea]
- [x] Task: Conductor - User Manual Verification 'Phase 1: Dependency Conflict Resolution' (Protocol in workflow.md)

## Phase 2: Pytest Import Path Resolution
- [x] Task: Investigate the current `PYTHONPATH` and project structure to identify the source of the import path mismatch. [68c1b6a]
- [ ] Task: Determine the correct `PYTHONPATH` modification needed to resolve the ambiguity. This could involve setting it in a shell script, a configuration file (like `pytest.ini` or `pyproject.toml`), or an environment variable.
- [ ] Task: Write a failing test that reproduces the `ImportPathMismatchError`. This might involve creating a temporary test file that triggers the specific import behavior.
- [ ] Task: Apply the `PYTHONPATH` modification.
- [ ] Task: Run the test suite and verify that the `ImportPathMismatchError` is no longer raised.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Pytest Import Path Resolution' (Protocol in workflow.md)
