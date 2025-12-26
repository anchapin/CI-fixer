# Evidence: Refactor Tests to Use Real Sandbox with Verification Toggle

**Evidence ID:** `ev-refactor-sandbox-939da4d5-20251223045513`  
**Holon ID:** `refactor-sandbox-939da4d5`  
**Type:** deduction  
**Verdict:** REFINE  
**Assurance Level:** medium

## Verification Checks

### Type Check: PASS
Kind='system' matches architectural change to test execution strategy.

### Constraint Check: REFINE
POTENTIAL VIOLATION: Unit Test invariant states tests MUST run <100ms with mocks. Real sandbox execution may violate this. Integration Test invariant (<5s) may also be at risk. Needs clarification on which tests this applies to.

### Logic Check: PASS
Method is logically sound: using real code in simulation mode tests actual implementation. Reduces mock brittleness. However, execution speed trade-off needs consideration.

### Notes
Radical approach - high potential benefit but violates unit test speed invariant. Recommend REFINE to specify integration-only or add timeout configuration.

---
*Created via FPF Phase 2: Deduction*
