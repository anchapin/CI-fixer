# H001: Reflection Learning System Persistence

**Status**: ✅ Validated (L2 - Induction)
**Date**: 2025-12-30
**Source**: User Proposed
**Validation**: PASSED - See 

## Hypothesis Statement

Implementing database persistence for the `ReflectionLearningSystem` will transform the agent from a stateless script into a learning system that improves with every run by storing failure patterns and successful fixes.

## Proposed Method (The Recipe)

### Step 1: Database Schema Updates
Add two new models to `prisma/schema.prisma` in the Historical Learning section:

```prisma
model LearningFailure {
  id            String   @id // Maps to patternId
  errorType     String
  failureReason String
  attemptedFix  String
  context       String   // JSON content
  frequency     Int      @default(1)
  firstSeen     DateTime @default(now())
  lastSeen      DateTime @default(now())

  @@index([errorType])
  @@index([frequency])
}

model LearningSuccess {
  id            String   @id // Maps to patternId
  errorType     String
  successfulFix String
  context       String   // JSON content
  timestamp     DateTime @default(now())

  @@index([errorType])
}
```

Then run: `npx prisma db push`

### Step 2: Service Logic Implementation

Update `services/reflection/learning-system.ts`:

1. Import database client: `import { db } from '../../db/client.js';`
2. Add `PersistentLearning` class with methods:
   - `load()`: Retrieves failures and successes from DB
   - `saveFailure(pattern)`: Upserts failure patterns with frequency tracking
   - `saveSuccess(id, item)`: Upserts success patterns
3. Integrate into `ReflectionLearningSystem`:
   - Add `async initialize()` method to load historical data on startup
   - Modify `recordFailure()` to persist immediately (fire & forget)
   - Modify `recordSuccess()` to persist immediately (fire & forget)

### Key Implementation Details

- **Initialization**: Hydrate in-memory maps from DB on first use
- **Persistence Strategy**: Fire & forget for non-blocking writes
- **Upsert Semantics**: Update frequency and timestamps for existing patterns
- **Scope Constraint**: Only use in Backend/Agent Core (Node.js), never in Frontend (React)

## Expected Outcome

- **Primary Outcome**: Agent persists learning across runs, enabling cumulative intelligence
- **Secondary Outcomes**:
  - Frequency tracking identifies recurring error patterns
  - Historical success patterns guide future fix attempts
  - Reduced repeated mistakes through pattern recognition
  - Foundation for future RL/reward optimization

## Scope

**Component**: Backend Services (`/services/reflection/`)
**Database**: SQLite/Prisma (`LearningFailure`, `LearningSuccess` models)
**Integration Point**: Agent Core initialization and tool execution

## Kind

**system** - Architectural enhancement to add persistence layer to learning system

## Rationale

```json
{
  "source": "User input",
  "anomaly": "ReflectionLearningSystem is currently stateless - patterns are lost between agent runs, preventing cumulative learning",
  "note": "Manually injected via /q1-add command",
  "priority": "High-leverage infrastructure change",
  "dependencies": [
    "Prisma client initialized",
    "ReflectionLearningService exists in services/reflection/",
    "Backend-only usage (no frontend imports)"
  ],
  "risk_factors": [
    "Database migration required (prisma db push)",
    "Performance impact if persistence blocks agent execution",
    "Need error handling for DB failures"
  ]
}
```

## Verification Criteria

- [ ] Schema updates applied without breaking existing models
- [ ] `PersistentLearning` class implemented with load/save methods
- [ ] `ReflectionLearningSystem.initialize()` loads historical data
- [ ] `recordFailure()` and `recordSuccess()` persist to DB
- [ ] No frontend imports of database-dependent code
- [ ] Error handling prevents agent crashes on DB failures
- [ ] Existing tests pass + new tests for persistence layer
- [ ] Coverage >85% for new persistence code

## Open Questions

1. Should persistence be synchronous (await) or asynchronous (fire & forget)?
   - **Proposal**: Fire & forget to avoid blocking agent execution
2. How to handle schema migration from in-memory to persisted state?
   - **Proposal**: Empty initial state, accumulates over time
3. Should we implement TTL or retention policies for old patterns?
   - **Proposal**: Not in initial implementation, future enhancement

## Related Components

- `prisma/schema.prisma` - Database schema
- `services/reflection/learning-system.ts` - Main implementation file
- `db/client.ts` - Prisma client initialization
- Agent Core - Consumer of learning system

---

**Next Steps**: Run `/q2-verify` to validate this hypothesis against the codebase before implementation.
