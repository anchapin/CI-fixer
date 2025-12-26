# Design Rationale Record (DRR)

**Decision ID:** `dec-bedea07e`
**Title:** Adopt Shared Test Fixtures for Discovery Service
**Date:** 2025-12-23
**Status:** DECIDED

---

## Context

PROBLEM:
12 integration tests failing after path_verification track completion (2025-12-22).

ROOT CAUSE:
- agent_tools.ts imports findUniqueFile from utils/fileVerification.ts (line 6)
- Tests mock services.discovery.findUniqueFile (service level)
- Mock doesn't intercept the utility function import
- Result: Tests call real file system operations, causing failures

CONSTRAINTS:
- TDD invariant: All features MUST have tests
- Coverage requirement: >80% coverage
- Unit test speed: <100ms with mocks
- Maintainability: DRY principle from workflow.md

CANDIDATES:
- H1: Update Test Mocks (R_eff=0.95, Low effort, Medium alignment)
- H2: Add Shared Fixtures (R_eff=0.95, Medium effort, High alignment)
- H4: Rollback + TDD (R_eff=0.95, High effort, Highest alignment)


---

## Decision

We decided to adopt H2: Add Shared Test Fixtures for Discovery Service.

This approach creates a centralized MockFileDiscoveryService fixture in __tests__/mocks/
that provides consistent mocking across all test files, reducing duplication and
improving long-term maintainability.


---

## Rationale

SELECTION CRITERIA:

1. Evidence Strength (R_eff): All options tied at 0.95
   - No technical basis for preference on evidence alone

2. Strategic Alignment: H2 rated HIGH
   - Aligns with DRY principle (workflow.md)
   - Reduces mock duplication from 7 locations to 1
   - Consistent mock behavior across all tests

3. Effort vs. Value: Medium investment, high long-term return
   - Higher initial cost than H1, but better maintainability
   - Lower risk than H4 (no rollback/rework required)
   - Scalable pattern for future test infrastructure

4. Project Context:
   - Tests are currently blocked but not at critical urgency
   - Team has time for proper refactoring
   - Investment in test health pays dividends over time

WHY NOT H1 (Update Mocks):
- Lowest effort but maintains technical debt
- Mock duplication remains (7 locations)
- No architectural improvement

WHY NOT H4 (Rollback + TDD):
- Highest principle alignment but excessive rework
- Feature already implemented, just needs test coverage
- Opportunity cost: delays other work


---

## Consequences

IMMEDIATE CONSEQUENCES:

1. Implementation Effort:
   - Create __tests__/mocks/MockFileDiscovery.ts
   - Update 7 test files to use shared fixture
   - Estimated effort: 2-4 hours

2. Test Behavior:
   - Tests will pass with consistent mocks
   - Mock changes centralized (easier maintenance)
   - No functional changes to production code

3. Files Modified:
   - NEW: __tests__/mocks/MockFileDiscovery.ts (fixture)
   - MODIFIED: 7 test files to import and use fixture

LONG-TERM CONSEQUENCES:

Positive:
- Reduced maintenance burden (single source of truth)
- Easier onboarding for new developers
- Consistent test patterns across codebase
- Foundation for other shared fixtures

Trade-offs:
- Higher initial cost than H1 (but worth it)
- Still using mocks (not real sandbox execution)
- Slight increase in code complexity

NEGATED RISKS:
- Low risk: Only affects test infrastructure
- No production code changes
- Can rollback to individual mocks if needed

NEXT STEPS:
1. Create MockFileDiscovery.ts with helper functions
2. Update test files incrementally (verify each passes)
3. Run full test suite to confirm all 12 tests pass
4. Document fixture usage in testing guidelines


---

## Characteristics (C.16 Scores)

```json
{
  "maintainability": 0.9,
  "testability": 0.95,
  "clarity": 0.85,
  "driness": 0.9,
  "efficiency": 0.7,
  "strategic_alignment": 0.85
}
```

---

## Audit Trail

- **Phase 1 (Abduction):** Generated 4 competing hypotheses (L0)
- **Phase 2 (Deduction):** 3 hypotheses passed logical verification (L0 -> L1)
- **Phase 3 (Induction):** 3 hypotheses passed empirical validation (L1 -> L2)
- **Phase 4 (Audit):** All 3 have R_eff = 0.95 (equal evidence strength)
- **Phase 5 (Decision):** Human selected H2 based on strategic alignment

---

## Relations

- **Selects:** `add-fixtures-0db8e03b` (Add Shared Test Fixtures for Discovery Service)
- **Rejects:**
  - `update-mocks-76603086` (Update Test Mocks for Path Verification)
  - `rollback-redesign-11b41914` (Rollback Path Verification and Redesign with Test-First Approach)

---

## Validity

**Revisit Conditions:**
- If shared fixture approach proves too complex (3 months)
- If test maintenance burden doesn't decrease (6 months)
- If team adopts different testing strategy (1 year)

**Success Metrics:**
- All 12 failing tests pass
- Mock maintenance time decreases
- New test adoption rate increases

---

*Generated via FPF Phase 5: Decision*
