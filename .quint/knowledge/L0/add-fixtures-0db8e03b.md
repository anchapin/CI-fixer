# Add Shared Test Fixtures for Discovery Service

**ID:** `add-fixtures-0db8e03b`  
**Kind:** episteme  
**Layer:** L0  
**Scope:** Test infrastructure for CI-Fixer  
**Relations:** MemberOf:test-failure-fix-5d31804c

## Content

**Method:**
1. Create a shared `MockFileDiscoveryService` in `__tests__/mocks/`
2. Provide helper methods that simulate: unique matches, multiple matches, no matches
3. Update all affected tests to use these fixtures
4. Centralize mock setup in test helper functions

**Scope:** Test infrastructure, all test files

**Rationale:** Shared fixtures reduce duplication and make tests more maintainable. Aligns with TDD principles from workflow.md.

---
*Created via FPF Phase 1: Abduction*
