# Test Reliability Best Practices

**Maintains 99.7% pass rate target as per DRR-2025-12-30-001 Phase 2**

---

## Overview

This document outlines best practices for maintaining high test reliability in the CI-Fixer project. Test reliability is critical for ensuring that the agent system works correctly and that changes don't introduce regressions.

## Target Metrics

- **Overall Pass Rate**: ≥ 99.7%
- **Individual Test Files**: ≥ 95%
- **Flaky Test Score**: < 30% (lower is better)
- **Test Duration**: Unit < 100ms, Integration < 5s

---

## Test Organization

### Structure

```
__tests__/
├── unit/              # Fast isolated tests (<100ms each)
│   ├── *.test.ts
│   └── *.enhanced.test.ts
├── integration/       # Multi-component tests (<5s each)
│   └── *.test.ts
└── e2e/              # Full system tests (Playwright)
    └── *.spec.ts
```

### Naming Conventions

- Unit tests: `<module>.test.ts` or `<module>.enhanced.test.ts`
- Integration tests: `<feature>.integration.test.ts`
- E2E tests: `<user-flow>.spec.ts`

---

## Writing Reliable Tests

### 1. Test Isolation

Each test should be independent and not rely on:

❌ **Bad**: Shared state between tests
```typescript
let sharedState: any;

describe('My Feature', () => {
  beforeEach(() => {
    sharedState = new MyService(); // Shared!
  });

  it('does something', () => {
    sharedState.setValue(1);
  });

  it('does something else', () => {
    // Depends on previous test's state!
    expect(sharedState.getValue()).toBe(1);
  });
});
```

✅ **Good**: Independent tests
```typescript
describe('My Feature', () => {
  it('does something', () => {
    const service = new MyService(); // Isolated
    service.setValue(1);
    expect(service.getValue()).toBe(1);
  });

  it('does something else', () => {
    const service = new MyService(); // Fresh instance
    service.setValue(2);
    expect(service.getValue()).toBe(2);
  });
});
```

### 2. Deterministic Results

Tests must produce the same results on every run.

❌ **Bad**: Non-deterministic behavior
```typescript
it('generates unique ID', () => {
  const id = Math.random().toString(36); // Random!
  expect(id).toBeDefined(); // Might pass or fail
});
```

✅ **Good**: Deterministic behavior
```typescript
it('generates unique ID', () => {
  const id = generateUniqueId('test'); // Deterministic seed
  expect(id).toMatch(/^test-/);
});
```

### 3. Proper Cleanup

Always clean up resources after tests.

❌ **Bad**: No cleanup
```typescript
it('creates a file', async () => {
  await fs.writeFile('/tmp/test.txt', 'content');
  expect(await fs.exists('/tmp/test.txt')).toBe(true);
  // File not cleaned up!
});
```

✅ **Good**: Proper cleanup
```typescript
it('creates a file', async () => {
  const filePath = `/tmp/test-${Date.now()}.txt`;
  try {
    await fs.writeFile(filePath, 'content');
    expect(await fs.exists(filePath)).toBe(true);
  } finally {
    await fs.unlink(filePath); // Always cleanup
  }
});
```

### 4. Timeout Management

Set appropriate timeouts for tests.

```typescript
// Unit tests: fast operations
it('calculates sum', () => {
  expect(add(1, 2)).toBe(3);
}, 10); // 10ms max

// Integration tests: database operations
it('saves to database', async () => {
  const result = await db.user.create({ data: { name: 'Test' } });
  expect(result).toBeDefined();
}, 5000); // 5s max

// E2E tests: full workflows
test('user completes purchase', async ({ page }) => {
  await page.goto('/purchase');
  await page.click('#buy');
  // ... full user flow
}, { timeout: 30000 }); // 30s max
```

---

## Handling Flaky Tests

### Detecting Flaky Tests

Use the reliability monitor to identify flaky tests:

```bash
npm run check-reliability -- --verbose
```

Look for tests with:
- Flaky score > 30%
- Inconsistent pass/fail patterns
- Time-dependent failures

### Fixing Flaky Tests

#### Race Conditions

❌ **Bad**: Unordered async operations
```typescript
it('loads data', async () => {
  const service = new DataService();
  service.load(); // No await!
  expect(service.data).toBeDefined(); // Might fail if load not complete
});
```

✅ **Good**: Proper async/await
```typescript
it('loads data', async () => {
  const service = new DataService();
  await service.load(); // Wait for completion
  expect(service.data).toBeDefined();
});
```

#### Time-Dependent Tests

❌ **Bad**: Depends on system time
```typescript
it('checks if expired', () => {
  const item = new Item({ expiresAt: Date.now() });
  expect(item.isExpired()).toBe(false); // Might fail at exact boundary
});
```

✅ **Good**: Use fixed time
```typescript
it('checks if expired', () => {
  const fixedTime = new Date('2025-01-01T00:00:00Z');
  vi.setSystemTime(fixedTime);

  const item = new Item({ expiresAt: fixedTime.getTime() + 1000 });
  expect(item.isExpired()).toBe(false);

  vi.useRealTimers(); // Cleanup
});
```

#### External Dependencies

❌ **Bad**: Depends on external API
```typescript
it('fetches user data', async () => {
  const data = await fetch('https://api.example.com/user');
  expect(data).toBeDefined(); // Fails if API is down
});
```

✅ **Good**: Mock external dependencies
```typescript
it('fetches user data', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ name: 'Test' });
  const service = new UserService(mockFetch);

  const data = await service.getUser();
  expect(data.name).toBe('Test');
});
```

---

## Test Speed Optimization

### Unit Tests (< 100ms)

- Use in-memory mocks instead of real I/O
- Avoid database/file system operations
- Mock external API calls

```typescript
// Fast unit test with mocks
it('processes user input', () => {
  const mockService = {
    validate: vi.fn().mockReturnValue(true),
    save: vi.fn().mockResolvedValue({ id: 1 })
  };

  const processor = new UserProcessor(mockService);
  const result = processor.process('test input');

  expect(result.success).toBe(true);
});
```

### Integration Tests (< 5s)

- Use test databases (SQLite in-memory)
- Minimize network calls
- Limit test data size

```typescript
// Fast integration test with in-memory DB
it('saves and retrieves user', async () => {
  const testDb = await createTestDatabase(); // In-memory SQLite
  const service = new UserService(testDb);

  await service.create({ name: 'Test' });
  const user = await service.findByName('Test');

  expect(user).toBeDefined();
  await testDb.destroy(); // Quick cleanup
});
```

---

## Monitoring and Alerts

### Check Reliability Locally

```bash
# Basic check
npm run check-reliability

# Verbose mode (shows all test details)
npm run check-reliability -- --verbose

# Export metrics to JSON
npm run check-reliability -- --export .reliability/metrics.json
```

### CI Integration

The GitHub Actions workflow (`.github/workflows/test-reliability.yml`) automatically:

1. Runs tests on every push and PR
2. Checks reliability metrics
3. Comments on PRs with reliability report
4. Fails if pass rate drops below 99.7%
5. Stores historical metrics for trend analysis

### Reliability Metrics

Key metrics to monitor:

- **Overall Pass Rate**: Should stay ≥ 99.7%
- **Flaky Tests**: Should stay < 5%
- **Test Duration**: Should not increase significantly
- **Failed Tests**: Investigate immediately if count > 0

---

## Continuous Improvement

### Weekly Review

1. Run reliability check: `npm run check-reliability -- --verbose`
2. Review flaky tests
3. Fix top 5 flaky tests
4. Document fixes

### Monthly Review

1. Analyze reliability trends over time
2. Update test documentation
3. Refactor slow tests
4. Add coverage for new features

### When Tests Fail

1. **Don't ignore failures** - Fix or skip with clear reason
2. **Investigate root cause** - Is it the code or the test?
3. **Add regression tests** - Prevent same issue
4. **Document fix** - Help others learn

---

## Quick Reference

### Adding New Tests

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('My Feature', () => {
  let service: MyService;

  beforeEach(() => {
    service = new MyService();
  });

  it('should do X', () => {
    const result = service.doX('input');
    expect(result).toBe('expected output');
  });

  it('should handle errors', async () => {
    vi.spyOn(service, 'externalCall').mockRejectedValue(new Error('API Error'));

    await expect(service.doSomething()).rejects.toThrow('API Error');
  });
});
```

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage
npm run test:coverage

# Watch mode (development)
npm run test:watch
```

### Checking Reliability

```bash
# Quick check
npm run check-reliability

# Detailed report
npm run check-reliability -- --verbose

# Export for CI
npm run check-reliability -- --export metrics.json
```

---

## Resources

- **Test Monitor Service**: `services/monitoring/TestReliabilityMonitor.ts`
- **CLI Tool**: `scripts/check-test-reliability.ts`
- **CI Workflow**: `.github/workflows/test-reliability.yml`
- **NPM Script**: `npm run check-reliability`

---

**Last Updated**: 2025-12-30
**Maintained By**: Phase 2 (User Reliability)
**Target**: 99.7% pass rate ✅
