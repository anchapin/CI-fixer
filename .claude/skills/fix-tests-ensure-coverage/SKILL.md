---
name: fix-tests-ensure-coverage
description: Automatically fix all test failures and ensure coverage targets are met. Runs tests, fixes issues iteratively until 100% pass with 0 skips, runs coverage, and adds tests until targets (85% lines, 80% branches) are achieved. Use when user says "fix tests", "ensure coverage", "make tests pass", or similar.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, TodoWrite
---

# Test Fixer & Coverage Enforcer

Automatically fixes all test failures and ensures coverage targets are met for the CI-fixer project.

## When to Use

Use this skill when the user asks to:
- "Fix all tests"
- "Ensure coverage targets"
- "Make tests pass with no skips"
- "Get coverage to 100%"
- "Run tests and fix failures"
- Similar variations

## Overview

This skill automates the test fixing and coverage process by:
1. Running all tests (unit + integration + e2e)
2. Analyzing failures and fixing them iteratively until 100% pass with 0 skips
3. Running test coverage
4. Identifying uncovered files and branches
5. Adding tests to meet coverage targets (85% lines, 80% branches)

## Coverage Targets

- **Lines**: 85%
- **Branches**: 80%
- **Functions**: 80%
- **Statements**: 85%

These thresholds are enforced in `vitest.config.ts`.

## Instructions

### Phase 1: Fix Test Failures

1. Run all tests:
   ```bash
   npm test
   ```

2. Parse test results to identify:
   - Failed tests
   - Skipped tests
   - Error messages

3. For each failure:
   - Read the test file and source file
   - Analyze the error
   - Determine if it's a test bug or implementation bug
   - Fix the issue (either fix the test or fix the implementation)
   - Re-run tests to verify the fix

4. Iterate until:
   - 100% of tests pass
   - 0 tests are skipped
   - Or maximum iterations (10) reached

5. For skipped tests:
   - Investigate why they are skipped
   - Fix the underlying issue preventing them from running
   - Remove `.skip` modifiers

### Phase 2: Ensure Coverage Targets

1. Run coverage report:
   ```bash
   npm run test:coverage
   ```

2. Parse coverage results to identify:
   - Files below line coverage threshold
   - Files below branch coverage threshold
   - Uncovered functions and statements

3. For each uncovered file:
   - Read the source file
   - Identify uncovered code paths
   - Read existing tests (if any)
   - Add comprehensive tests covering:
     - Edge cases
     - Error conditions
     - Different branch conditions
     - Boundary values

4. Iterate until:
   - All coverage targets met
   - Or maximum iterations (5) reached

## Test Location Patterns

Tests are located in `__tests__/` with the following structure:
- Unit tests: `__tests__/unit/**/*.test.ts`
- Integration tests: `__tests__/integration/**/*.test.ts`
- E2E tests: `__tests__/e2e/**/*.spec.ts`

## Fix Strategy

### For Test Failures:

1. **Understand the error**: Read the error message carefully
2. **Read the source**: Understand what the code is supposed to do
3. **Read the test**: Understand what the test is checking
4. **Determine the fix**:
   - If test is wrong → fix the test
   - If implementation is wrong → fix the implementation
   - If test is outdated → update the test
   - If API changed → update test and implementation

### For Coverage Gaps:

1. **Analyze uncovered code**: Use coverage report to see what's not tested
2. **Prioritize**:
   - Critical business logic first
   - Error handling paths
   - Edge cases and boundary conditions
3. **Write meaningful tests**: Don't just add lines to hit coverage - tests should verify actual behavior
4. **Follow existing patterns**: Match the style and structure of existing tests in the file

## Running Tests

### All tests:
```bash
npm test
```

### Specific test suites:
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

### Coverage:
```bash
npm run test:coverage
```

### Single test file:
```bash
npx vitest run path/to/test.test.ts
```

## Example Usage

User: "Fix all my tests and make sure coverage is good"

Claude will:
1. Run `npm test` to see current state
2. Identify failures and skipped tests
3. Fix each failure iteratively
4. Run `npm run test:coverage`
5. Identify coverage gaps
6. Add tests to meet targets
7. Report final results

## Important Notes

- **TDD approach**: Write tests before implementation when possible
- **Don't skip tests**: Ensure all tests can run (remove `.skip` modifiers)
- **Meaningful tests**: Coverage for the sake of coverage is not useful - tests should verify actual behavior
- **Fix the root cause**: Don't just make tests pass by making them less specific
- **Consider performance**: Unit tests should be <100ms, integration tests <5s
- **Non-interactive**: Use `CI=true` for any watch-mode tools

## Troubleshooting

### Tests keep failing:
- Check if dependencies are installed
- Verify database is initialized (`npx prisma db push`)
- Check environment variables (`.env.local`)
- Look for circular dependencies or import issues

### Coverage not improving:
- Ensure new tests actually execute the uncovered code
- Check for conditional code paths (if statements, switch cases)
- Look for error handling that's not triggered
- Verify async/await code paths are tested

### Skipped tests:
- Find `.skip` modifiers and remove them
- Check if tests are skipped with `it.skip` or `describe.skip`
- Ensure prerequisites are met (e.g., test data, services)
