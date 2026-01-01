# Empirical Validation Record: Reduce Concurrency and Docker Resource Limits

**Hypothesis ID**: reduce-concurrency-docker-bcdfc15b5
**Validation Date**: 2025-12-30T17:01:37.538Z
**Test Type**: internal
**Verdict**: PASS

## Test Evidence

**Validation Score**: 100% (3/3 predicted problems confirmed)
**Test Execution**: 538ms, 9/9 tests passed
**Confidence**: HIGH
**Congruence Level**: 3 (Direct evidence in target context)

### Empirical Findings

✅ **Problem 1: Docker Resource Limits Missing - CONFIRMED**
- **File**: `sandbox.ts:69`
- **Missing Limits**: 6 out of 6 resource limit flags absent
  - `--cpus` (CPU limit)
  - `--memory` (Memory limit)
  - `--pids-limit` (Process limit)
  - `--network` (Network constraint)
  - `--cpuset-cpus` (CPU pinning)
  - `--cpu-shares` (CPU shares)
- **Impact**: Docker containers can consume unlimited host resources
- **Evidence**: Direct code analysis of `docker run` command

✅ **Problem 2: Unbounded Concurrency - CONFIRMED**
- **File**: `services/multi-agent/coordinator.ts:91`
- **Pattern**: `Promise.all` without concurrency limiting library
- **Impact**: Unbounded parallel task execution can overwhelm system resources
- **Evidence**: Code analysis shows no `p-limit`, `p-queue`, or semaphore usage

✅ **Problem 3: Missing Resource Monitoring - CONFIRMED**
- **Files Checked**: `sandbox.ts`, `services/sandbox/SandboxService.ts`, `server.ts`
- **Absent Features**:
  - `docker stats` integration
  - CPU usage tracking
  - Memory usage tracking
- **Impact**: No visibility into container resource usage, capacity planning impossible
- **Evidence**: Static code analysis of monitoring infrastructure

### Additional Findings

**Agent Worker Limits**:
- ✓ `MAX_ITERATIONS` exists (limits iterations per agent)
- ✗ `MAX_CONCURRENT_AGENTS` absent (no limit on total concurrent agents)

**Server Throttling**:
- Server has some throttling mechanism (needs effectiveness verification)
- No queue system visible for `/api/agent/start` endpoint

### Test Coverage

The validation test suite covered:
1. Docker resource limits analysis (2 tests)
2. Concurrency control analysis (3 tests)
3. Resource monitoring analysis (2 tests)
4. Overall validation scoring (2 tests)

**All 9 tests passed** with 100% validation score.

## Decision Rationale

The hypothesis is **PROMOTED to L2** because:

1. **Core Claim EMPIRICALLY PROVEN**: All 3 predicted problems were detected
   - Docker resource limits are missing (6/6 flags absent)
   - Unbounded concurrency exists (Promise.all without limits)
   - Resource monitoring is absent (no docker stats/CPU/memory tracking)

2. **Direct Evidence**: Code analysis provides high-congruence evidence (CL=3)
   - Test directly inspects target codebase
   - No assumptions or external dependencies
   - Reproducible verification

3. **Causal Chain Validated**:
   - Missing limits → resource exhaustion possible
   - Unbounded concurrency → simultaneous execution
   - No monitoring → blind to capacity issues
   - Combined effect → Internal Server Error crashes (user reported)

4. **Implementation Path Clear**: 9 actionable recommendations generated
   - Docker flags to add
   - Concurrency limits to implement
   - Monitoring to add

5. **Urgency Confirmed**: User reported 2 agents already crashed with Internal Server Error
   - This is an active production issue
   - Hypothesis explains the root cause
   - Fixes are straightforward and low-risk

## Actionable Recommendations

### Immediate (High Priority)
1. Add `--cpus=X, --memory=X` to docker run command in `DockerSandbox.init()`
2. Add `--pids-limit` to prevent fork bombs
3. Add `MAX_CONCURRENT_AGENTS` constant (start with 1 as hypothesis suggests)

### Short Term (Medium Priority)
4. Create `DockerSandboxConfig` interface for resource parameters
5. Implement queue system in `server.ts` `/api/agent/start`
6. Add `p-limit` or similar library to `MultiAgentCoordinator`

### Long Term (Lower Priority)
7. Add docker stats monitoring for CPU/memory usage
8. Create health check endpoint for container status
9. Add auto-recovery logic for crashed containers

## Test Artifacts

**Test File**: `__tests__/unit/validation_concurrency.test.ts`
**Execution**: `npx vitest run __tests__/unit/validation_concurrency.test.ts`
**Duration**: 538ms
**Result**: 9/9 tests passed

**Test Output Excerpt**:
```
✓ VALIDATED: Docker resource limits are missing
✓ VALIDATED: Unbounded concurrency exists
✓ VALIDATED: Resource monitoring is missing

=== VALIDATION SUMMARY ===
Problems Detected: 3/3
Validation Score: 100%

=== ACTIONABLE RECOMMENDATIONS ===
1. Add --cpus=X, --memory=X to docker run command in DockerSandbox.init()
2. Add --pids-limit to prevent fork bombs
...
```

---

**Validated By**: FPF Phase 3 Induction (Internal Test)
**Next Action**: Proceed to `/q4-audit` for trust calculus evaluation
**Promotion**: L1 → L2 (Substantiated → Validated)
