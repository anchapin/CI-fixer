# Refactor Tests to Use Real Sandbox with Verification Toggle

**ID:** `refactor-sandbox-939da4d5`  
**Kind:** system  
**Layer:** L0  
**Scope:** Integration test architecture  
**Relations:** MemberOf:test-failure-fix-5d31804c

## Content

**Method:**
1. Add a `disablePathVerification` flag to `FileDiscoveryService`
2. Modify tests to use `SimulationSandbox` with this flag set
3. Remove extensive mocking - let the real code run in simulation mode
4. Tests become more realistic and less brittle to mock changes

**Scope:** Test infrastructure, `SimulationSandbox`, `FileDiscoveryService`

**Rationale:** Mocks are a maintenance burden. Using real code in simulation mode tests the actual implementation. More aligned with integration testing philosophy.

---
*Created via FPF Phase 1: Abduction*
