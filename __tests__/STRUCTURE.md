# Test Directory Structure

This document explains the reorganized test directory structure for better organization and maintainability.

## Directory Layout

```
__tests__/
├── unit/                           # Unit tests (isolated, fast)
│   ├── graph/
│   │   └── nodes/                  # Individual graph node tests
│   │       ├── analysis-node.test.ts
│   │       ├── planning-node.test.ts
│   │       ├── execution-node.test.ts
│   │       └── verification-node.test.ts
│   ├── services/                   # Service layer tests
│   │   ├── llm-service.test.ts
│   │   ├── github-service.test.ts
│   │   ├── sandbox-service.test.ts
│   │   └── analysis-service.test.ts
│   ├── database/                   # Database-related tests
│   │   └── schema-validation.test.ts
│   └── agent_logic_mocked.test.ts  # Mocked agent logic tests
│
├── integration/                    # Integration tests (multiple components)
│   ├── graph/
│   │   ├── flow/                   # Graph flow tests
│   │   │   ├── graph-flow.test.ts
│   │   │   └── error-scenarios.test.ts
│   │   ├── analysis-node-db.test.ts
│   │   └── execution-node-db.test.ts
│   └── agent/                      # Full agent tests
│       ├── agentLoop.test.ts
│       ├── agentLoop-refactored.test.ts
│       └── agent_supervisor.test.ts
│
├── performance/                    # Performance benchmarks
│   └── graph-performance.test.ts
│
├── snapshots/                      # Snapshot tests
│   └── output-snapshots.test.ts
│
├── e2e/                           # End-to-end tests
│   └── (playwright tests)
│
├── fixtures/                       # Shared test data
│   └── (future: sample files, mock data)
│
├── helpers/                        # Test utilities
│   ├── test-fixtures.ts
│   ├── test-builders.ts
│   ├── custom-assertions.ts
│   ├── test-database.ts
│   └── README.md
│
└── mocks/                         # Mock implementations
    ├── MockLLM.ts
    └── MockSandbox.ts
```

## Directory Purposes

### `/unit`
**Purpose:** Fast, isolated tests for individual components  
**Characteristics:**
- No external dependencies
- Mocked services
- Fast execution (< 100ms per test)
- High code coverage

**Subdirectories:**
- `graph/nodes/` - Individual graph node logic
- `services/` - Service layer functionality
- `database/` - Database schema and queries

### `/integration`
**Purpose:** Tests that verify multiple components working together  
**Characteristics:**
- Real database (test instance)
- Multiple components interact
- Moderate execution time (< 5s per test)
- Realistic scenarios

**Subdirectories:**
- `graph/flow/` - Complete graph state machine flows
- `agent/` - Full agent execution tests

### `/performance`
**Purpose:** Performance benchmarks and regression detection  
**Characteristics:**
- Timing assertions
- Resource usage monitoring
- Baseline comparisons
- Run separately from main suite

### `/snapshots`
**Purpose:** Snapshot tests for formatted output  
**Characteristics:**
- Captures output structure
- Detects unintended changes
- Easy to review diffs
- Version controlled snapshots

### `/e2e`
**Purpose:** End-to-end tests with real services  
**Characteristics:**
- Full system integration
- Real external services (when possible)
- Slowest tests
- Run in CI only

### `/fixtures`
**Purpose:** Shared test data and sample files  
**Characteristics:**
- Reusable test data
- Sample log files
- Mock responses
- Configuration templates

### `/helpers`
**Purpose:** Test utilities and shared code  
**Contents:**
- Factory functions
- Builder patterns
- Custom matchers
- Database helpers

### `/mocks`
**Purpose:** Mock implementations of services  
**Contents:**
- MockLLM
- MockSandbox
- Other service mocks

## Migration Guide

### Moving Existing Tests

**Unit Tests:**
```bash
# Move node-specific tests
mv __tests__/integration/graph/analysis-node.test.ts __tests__/unit/graph/nodes/
mv __tests__/integration/graph/planning-node.test.ts __tests__/unit/graph/nodes/
```

**Integration Tests:**
```bash
# Move flow tests
mv __tests__/integration/graph/graph-flow.test.ts __tests__/integration/graph/flow/
mv __tests__/integration/error-scenarios.test.ts __tests__/integration/graph/flow/
```

**Database Tests:**
```bash
# Move schema tests
mv __tests__/unit/schema-validation.test.ts __tests__/unit/database/
```

### Running Tests by Category

```bash
# Unit tests only
npm test -- __tests__/unit

# Integration tests only
npm test -- __tests__/integration

# Performance benchmarks
npm test -- __tests__/performance

# Snapshot tests
npm test -- __tests__/snapshots

# Specific category
npm test -- __tests__/unit/services
npm test -- __tests__/integration/graph/flow
```

## Best Practices

### Test Placement

**Unit Test** if:
- Tests a single function/class
- All dependencies are mocked
- Fast execution (< 100ms)
- No database/network

**Integration Test** if:
- Tests multiple components
- Uses real database
- Tests component interactions
- Moderate execution time

**Performance Test** if:
- Measures execution time
- Monitors resource usage
- Compares to baseline
- Has timing assertions

**Snapshot Test** if:
- Tests formatted output
- Captures structure
- Detects unintended changes
- Output is stable

### Naming Conventions

```
<component>-<type>.test.ts

Examples:
- analysis-node.test.ts
- llm-service.test.ts
- graph-flow.test.ts
- output-snapshots.test.ts
```

### Import Paths

Update imports when moving files:

```typescript
// Before (from __tests__/integration/graph/)
import { TestDatabaseManager } from '../../helpers/test-database.js';

// After (from __tests__/unit/graph/nodes/)
import { TestDatabaseManager } from '../../../helpers/test-database.js';
```

## Benefits

### Organization
- ✅ Clear separation by test type
- ✅ Easy to find related tests
- ✅ Logical grouping

### Performance
- ✅ Run fast unit tests frequently
- ✅ Run slow integration tests less often
- ✅ Separate performance benchmarks

### Maintainability
- ✅ Easier to navigate
- ✅ Clear responsibilities
- ✅ Better scalability

### CI/CD
- ✅ Parallel test execution
- ✅ Selective test running
- ✅ Better caching

## Future Enhancements

1. **Fixtures Directory**
   - Add sample log files
   - Mock API responses
   - Configuration templates

2. **Contract Tests**
   - Add `/contract` directory
   - Test API contracts
   - Service interfaces

3. **Visual Tests**
   - Add `/visual` directory (if UI exists)
   - Screenshot comparisons
   - Visual regression

4. **Load Tests**
   - Add `/load` directory
   - Stress testing
   - Concurrent execution

## Migration Status

- ✅ Directory structure created
- ✅ Documentation added
- ⏳ Tests to be migrated (optional)
- ⏳ Import paths to be updated (optional)

The new structure is ready to use! Tests can be migrated gradually as they're updated.
