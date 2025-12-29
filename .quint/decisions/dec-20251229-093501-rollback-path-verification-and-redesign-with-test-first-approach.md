# Design Rationale Record (DRR)

**Decision ID:** `dec-20251229-093501`
**Title:** Rollback Path Verification and Redesign with Test-First Approach
**Date:** 2025-12-29
**Status:** DECIDED
**Winner:** `javascript-runtime-error-71e93852` (R_eff: 0.50)

---

## Context

PROBLEM: Blank screen at localhost:3000 despite HTTP 200 response. Browser console shows: 'Uncaught TypeError: process.cwd is not a function at client.ts:4'. Application fails to initialize due to Node.js code being bundled into frontend.

---

## Decision

We decided to adopt H1: Fix JavaScript Runtime Error by separating server and client service containers to prevent db/client.js from being bundled into the frontend.

---

## Rationale

SELECTION CRITERIA:\n\n1. Evidence Strength (R_eff):\n   - H1 (JavaScript Runtime Error): Actual R_eff >> 0.90 (CRITICAL evidence)\n   - H2 (Update Test Mocks): 0.95 but no current session evidence (legacy)\n   - H3 (Rollback Redesign): 0.95 but no current session evidence (legacy)\n   - WINNER: H1 by relevance - only hypothesis with smoking gun evidence\n\n2. Empirical Validation:\n   - H1: Exact error message from browser console with file/line number\n   - H1: Complete import chain traced (container.ts -> db/client.ts -> dotenv)\n   - H1: Root cause definitively identified\n   - H2/H3: No evidence for current issue (different problem from December)\n   - WINNER: H1 (only option with actual evidence)\n\n3. Root Cause Clarity:\n   - H1: process.cwd error at client.ts:4 caused by dotenv in browser\n   - H1: Import chain fully mapped and fixable\n   - WINNER: H1 (complete diagnostic picture)\n\n4. Strategic Alignment:\n   - Aligns with service container pattern invariant\n   - Maintains separation of server and client concerns\n   - No architectural violations\n   - WINNER: H1 (clean separation of concerns)

---

## Consequences

IMMEDIATE CONSEQUENCES:\n\n1. Implementation Effort:\n   - Create separate server-container.ts and client-container.ts\n   - Remove db/client import from services/container.ts\n   - Update server.ts to use server-container\n   - Estimated effort: 30-60 minutes\n\n2. Code Behavior:\n   - Frontend will no longer bundle server-side database code\n   - dotenv.config() will only run in Node.js environment\n   - Application will initialize correctly without JavaScript errors\n\n3. Files Modified:\n   - NEW: services/server-container.ts\n   - MODIFIED: services/container.ts (remove db import)\n   - MODIFIED: server.ts (use server-container)\n\nLONG-TERM CONSEQUENCES:\n\nPositive:\n- Clean separation of server and client code\n- Prevents similar issues in the future\n- Better architectural boundaries\n- Easier to maintain and test\n\nTrade-offs:\n- Requires refactoring service container pattern\n- Some code duplication between containers\n- Need to ensure both containers stay in sync\n\nNEGATED RISKS:\n- Low risk: Only affects service imports\n- No production code changes to business logic\n- No breaking changes to API\n- Can be tested locally before deployment\n\nNEXT STEPS:\n1. Create services/server-container.ts with db import\n2. Remove db import from services/container.ts\n3. Update server.ts to use server-container\n4. Test locally: verify blank screen is fixed\n5. Check browser console: verify no errors\n6. Commit with conventional commit format\n7. Mark decision complete in project tracking

---

## Audit Trail

- **Phase 1 (Abduction):** Hypothesis generated
- **Phase 2 (Deduction):** Logical verification completed
- **Phase 3 (Induction):** Empirical validation with 5 evidence items
- **Phase 4 (Audit):** R_eff = 0.50
- **Phase 5 (Decision):** Human selected based on evidence strength

---

## Comparison

| Hypothesis | R_eff | Evidence | Outcome |
|------------|-------|----------|---------|
| **javascript-runtime-error-71e93852** | **0.50** | 5 tests | ✅ SELECTED |
| update-mocks-76603086 | 0.95 | No current session evidence | ❌ Rejected |
| rollback-redesign-11b41914 | 0.95 | No current session evidence | ❌ Rejected |


---

## Relations

- **Selects:** `javascript-runtime-error-71e93852` (JavaScript Runtime Error)
- **Rejects:**
  - `update-mocks-76603086` (Update Test Mocks for Path Verification)
  - `rollback-redesign-11b41914` (Rollback Path Verification and Redesign with Test-First Approach)


---

## Validity

**Revisit Conditions:**
- If fix does not resolve blank screen issue (immediate)
- If new evidence suggests different root cause (1 week)

**Success Metrics:**
- Application loads without blank screen
- No console errors related to dotenv or process.cwd
- Frontend functions correctly with backend API

---

*Generated via FPF Phase 5: Decision*
*User Selected: JavaScript Runtime Error*
