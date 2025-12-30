# Reliability Layer Enhancements

## Overview
Building on the Multi-Layer Agent Reliability Enhancement (Phases 1-4), this track adds intelligent, adaptive capabilities to make the agent more resilient and autonomous.

## Selected Enhancements
1. **Adaptive Thresholds** - ML-based threshold optimization using historical data
2. **Recovery Strategies** - Automatic recovery attempts instead of hard halts
3. **Telemetry & Observability** - Monitoring and insights for reliability layer activations

## Architecture

### 1. Telemetry Layer (Foundation)
**Purpose**: Collect and analyze data on reliability layer activations

**Components**:
- `services/reliability/ReliabilityTelemetry.ts`
  - Records when each reliability layer triggers
  - Tracks success/failure outcomes
  - Stores historical threshold data

- `services/reliability/ReliabilityMetrics.ts`
  - Calculates metrics: trigger rate, recovery success rate, false positive rate
  - Aggregates by error type, project, complexity range

**Data Model** (extend existing schema):
```prisma
model ReliabilityEvent {
  id          String   @id
  layer       String   // "phase2-reproduction", "phase3-loop-detection"
  triggered   Boolean
  threshold   Float    // The threshold value used
  context     String   // JSON: complexity, iteration, error type
  outcome     String   // "recovered", "failed", "human-intervention"
  recoveryAttempted Boolean
  recoverySuccess Boolean
  timestamp   DateTime @default(now())
}
```

### 2. Adaptive Thresholds
**Purpose**: Optimize thresholds based on historical performance

**Components**:
- `services/reliability/AdaptiveThresholdService.ts`
  - Analyzes historical events to find optimal thresholds
  - Uses success/failure patterns to adjust
  - Implements simple ML: percentile-based, or statistical process control

**Algorithm**:
```typescript
// For each threshold (complexity limit, iteration count):
// 1. Calculate success rate at current threshold
// 2. If too many false positives (agent would have succeeded): increase threshold
// 3. If too many failures (agent needed intervention): decrease threshold
// 4. Apply smoothing to avoid overfitting to recent data
```

**Config** (add to settings):
```typescript
adaptiveThresholds: {
  enabled: true,
  complexityThreshold: {
    min: 10,
    max: 25,
    current: 15,
    learningRate: 0.1
  },
  iterationThreshold: {
    min: 1,
    max: 5,
    current: 2,
    learningRate: 0.05
  }
}
```

### 3. Recovery Strategies
**Purpose**: Give agent autonomy to recover from threshold triggers

**Components**:
- `services/reliability/RecoveryStrategyService.ts`
  - Selects appropriate recovery strategy based on context
  - Tracks success rates of each strategy

**Strategy Hierarchy** (try in order):

**For Reproduction Command Missing (Phase 2)**:
1. **Infer from log patterns** - Extract test command from CI logs
2. **Search common patterns** - Try `npm test`, `pytest`, `cargo test`
3. **Request LLM analysis** - Ask LLM to determine reproduction command
4. **Request human input** - Last resort

**For Strategy Loop Detected (Phase 3)**:
1. **Reduce scope** - Identify subset of files to fix (break down problem)
2. **Switch fix mode** - Try alternative approach (e.g., recreation instead of modification)
3. **Regenerate with different context** - Add guidance to LLM about the loop
4. **Request human guidance** - Last resort

**Implementation**:
```typescript
interface RecoveryStrategy {
  name: string;
  execute(state: GraphState): Promise<RecoveryResult>;
  applicable(state: GraphState): boolean;
  successRate: number; // Updated by telemetry
}

class RecoveryOrchestrator {
  async attemptRecovery(
    state: GraphState,
    trigger: 'reproduction-missing' | 'strategy-loop'
  ): Promise<RecoveryResult> {
    const strategies = this.getStrategies(trigger);
    for (const strategy of strategies) {
      if (strategy.applicable(state)) {
        const result = await strategy.execute(state);
        this.recordAttempt(strategy.name, result);
        if (result.success) return result;
      }
    }
    return { success: false, reason: 'All recovery attempts failed' };
  }
}
```

## Implementation Plan

### Phase 1: Telemetry Layer (2-3 hours)
- [x] Create `ReliabilityTelemetry.ts` service
- [x] Add `ReliabilityEvent` Prisma model
- [x] Record events when reliability layers trigger
- [x] Add metrics aggregation functions
- [x] Write unit tests for telemetry (37 tests passing)
- [x] Write integration test with database (10 tests passing)

### Phase 2: Adaptive Thresholds (3-4 hours)
- [ ] Create `AdaptiveThresholdService.ts`
- [ ] Implement threshold analysis algorithm
- [ ] Add threshold config to settings
- [ ] Integrate with coordinator (use adaptive thresholds)
- [ ] Write unit tests for threshold calculation
- [ ] Write integration test with historical data

### Phase 3: Recovery Strategies (3-4 hours)
- [ ] Create `RecoveryStrategyService.ts` and `RecoveryOrchestrator`
- [ ] Implement reproduction command inference strategies
- [ ] Implement strategy loop recovery strategies
- [ ] Integrate with coordinator (attempt recovery before halt)
- [ ] Write unit tests for each strategy
- [ ] Write integration test demonstrating recovery

### Phase 4: Integration & Testing (2 hours)
- [ ] Update coordinator to use all enhancements together
- [ ] Create end-to-end test demonstrating full flow
- [ ] Add telemetry dashboard endpoint (optional)
- [ ] Run full test suite
- [ ] Create checkpoint commit

## Success Criteria
- [ ] Telemetry successfully records all reliability layer activations
- [ ] Adaptive thresholds adjust based on at least 30 historical events
- [ ] Recovery strategies successfully recover from >50% of threshold triggers
- [ ] All tests passing with >80% coverage
- [ ] Performance impact <100ms per agent run

## Files to Create
- `services/reliability/ReliabilityTelemetry.ts`
- `services/reliability/ReliabilityMetrics.ts`
- `services/reliability/AdaptiveThresholdService.ts`
- `services/reliability/RecoveryStrategyService.ts`
- `services/reliability/RecoveryOrchestrator.ts`
- `services/reliability/strategies/*.ts` (individual strategy implementations)
- `__tests__/unit/services/reliability/*.test.ts`
- `__tests__/integration/reliability/*.test.ts`

## Files to Modify
- `prisma/schema.prisma` - Add ReliabilityEvent model
- `agent/graph/coordinator.ts` - Integrate enhancements
- `services/container.ts` - Register new services
- `types.ts` - Add new types for recovery strategies
