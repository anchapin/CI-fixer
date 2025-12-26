# Add Shared Test Fixtures for Discovery Service

**ID:** `add-fixtures-0db8e03b`  
**Kind:** episteme  
**Layer:** L1 (Substantiated)  
**Scope:** Test infrastructure for CI-Fixer

## Content

**Method:**
1. Create a shared `MockFileDiscoveryService` in `__tests__/mocks/`
2. Provide helper methods that simulate: unique matches, multiple matches, no matches
3. Update all affected tests to use these fixtures
4. Centralize mock setup in test helper functions

**Scope:** Test infrastructure, all test files

**Rationale:** Shared fixtures reduce duplication and make tests more maintainable. Aligns with TDD principles from workflow.md.

## Verification Status
✓ **PASS** - Promoted from L0 via Phase 2: Deduction

This hypothesis has been logically verified and found to be:
- Type-safe and compatible with project architecture
- Consistent with all invariants in the Bounded Context
- Logically sound with clear causal links

---
*Verified via FPF Phase 2: Deduction*
