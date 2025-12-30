# Reflection Learning System - Retention Policy

## Overview

The Reflection Learning System maintains two types of persistent data:
- **LearningFailure**: Error patterns that failed to fix (for pattern analysis)
- **LearningSuccess**: Successful fix patterns (for future reference)

This document defines the retention policy for these learning patterns.

---

## Retention Policy

### Default Retention Period

| Pattern Type | Default Retention | Rationale |
|--------------|------------------|-----------|
| LearningFailure | 90 days | Error patterns become stale as code evolves |
| LearningSuccess | 180 days | Successful fixes have longer-term value |

### Retention Triggers

Patterns are automatically cleaned up based on:

1. **Time-based expiration**: Patterns older than retention period are removed
2. **Frequency-based eviction**: Least frequently used patterns are removed first when database size limits are approached
3. **Manual cleanup**: Operators can trigger cleanup via API

---

## Implementation

### Automatic Cleanup (Current: Manual)

The `ReflectionLearningSystem` has a `clearOldPatterns()` method for manual cleanup:

```typescript
// Clear patterns older than 30 days
system.clearOldPatterns(30 * 24 * 60 * 60 * 1000);
```

**Future Enhancement**: Add automated cleanup via cron job or scheduled task.

### Database Size Limits

| Metric | Threshold | Action |
|--------|-----------|--------|
| Total patterns | 10,000 | Warning logged |
| Total patterns | 50,000 | Auto-cleanup triggered (oldest first) |
| Database file size | 50 MB | Warning logged |
| Database file size | 200 MB | Auto-cleanup triggered |

---

## Configuration

Retention policy can be configured via environment variables:

```bash
# .env configuration
LEARNING_RETENTION_DAYS=90          # Default: 90 days
LEARNING_RETENTION_ENABLED=true     # Enable/disable retention
LEARNING_MAX_PATTERNS=50000         # Maximum patterns before cleanup
LEARNING_AUTO_CLEANUP=false         # Automatic cleanup (future)
```

---

## Backup Before Cleanup

**IMPORTANT**: Always backup the database before running cleanup operations.

See [BACKUP_STRATEGY.md](./BACKUP_STRATEGY.md) for backup procedures.

---

## Cleanup Procedure

### Manual Cleanup

```bash
# Via API endpoint (future)
curl -X POST http://localhost:3001/api/learning/cleanup \
  -H "Content-Type: application/json" \
  -d '{"maxAgeDays": 90, "dryRun": true}'
```

### Programmatic Cleanup

```typescript
import { getReflectionSystem } from './services/reflection/learning-system.js';

const system = getReflectionSystem();
await system.initialize();

// Clear patterns older than 90 days
const cutoffTime = Date.now() - (90 * 24 * 60 * 60 * 1000);
system.clearOldPatterns(90 * 24 * 60 * 60 * 1000);

// Verify cleanup
const stats = system.getStats();
console.log(`Remaining patterns: ${stats.totalFailurePatterns} failures, ${stats.totalSuccessPatterns} successes`);
```

---

## Monitoring

Retention operations should be monitored via:

1. **OpenTelemetry metrics**: Track pattern counts and cleanup operations
2. **Health check endpoint**: Monitor database size and pattern counts
3. **Logging**: All cleanup operations should be logged

### Metrics to Monitor

- `learning_pattern_count_total` - Total number of stored patterns
- `learning_cleanup_operations_total` - Number of cleanup operations
- `learning_patterns_deleted_total` - Number of patterns deleted

---

## Data Privacy Considerations

The learning system stores:
- Error types and failure reasons
- Attempted fixes and context
- File paths and code snippets

**Privacy Notes**:
- Context may contain sensitive code snippets
- File paths may reveal project structure
- No user-identifiable information is stored

**Recommendation**: Review patterns before sharing database files externally.

---

## Recovery

If patterns are accidentally deleted:

1. Restore from backup (see [BACKUP_STRATEGY.md](./BACKUP_STRATEGY.md))
2. Patterns will be re-learned as the agent encounters errors

**Note**: Deleted patterns will be re-learned over time as the agent encounters similar errors.

---

## Policy Review

This retention policy should be reviewed quarterly or when:
- Database size exceeds expectations
- Pattern effectiveness degrades
- New regulatory requirements emerge

**Next Review Date**: 2026-03-30

---

## Related Documents

- [BACKUP_STRATEGY.md](./BACKUP_STRATEGY.md) - Database backup procedures
- [DRR-2025-12-30-001](../.quint/decisions/DRR-2025-12-30-001-reflection-learning-persistence.md) - Implementation decision record
