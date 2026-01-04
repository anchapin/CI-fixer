# Test Fixer & Coverage Enforcer Skill

A Claude Code Skill that automatically fixes all test failures and ensures coverage targets are met.

## What It Does

This skill automates the process of:
1. Running all tests (unit, integration, e2e)
2. Analyzing failures
3. Fixing issues iteratively until **100% of tests pass with 0 skips**
4. Running test coverage
5. Adding tests until coverage targets are met (**85% lines, 80% branches**)

## How to Use

### Automatic Invocation (Recommended)

Claude Code will automatically use this skill when you ask it to:

- "Fix all my tests"
- "Ensure coverage targets are met"
- "Make all tests pass with no skips"
- "Get coverage to 100%"
- "Run tests and fix failures"

Just describe what you want in natural language, and Claude will handle the rest.

### Manual Script Execution

You can also run the standalone script directly:

```bash
npm run fix-tests
```

Or with tsx:

```bash
tsx scripts/fix-tests-ensure-coverage.ts
```

## Coverage Targets

The skill ensures these coverage thresholds (configured in `vitest.config.ts`):

| Metric | Target |
|--------|--------|
| Lines | 85% |
| Branches | 80% |
| Functions | 80% |
| Statements | 85% |

## What Gets Fixed

### Test Failures
- Incorrect assertions
- Outdated test expectations
- Broken implementation code
- Missing test setup/teardown
- Async/await issues
- Timeout problems

### Skipped Tests
- Removes `.skip` modifiers
- Fixes underlying issues that caused skips
- Ensures all tests can run

### Coverage Gaps
- Uncovered functions
- Missing edge case tests
- Untested error handling
- Branch conditions not exercised
- Boundary values not tested

## Test Structure

```
__tests__/
├── unit/           # Fast isolated tests (<100ms each)
├── integration/    # Multi-component tests (<5s each)
└── e2e/           # Full system tests (Playwright)
```

## Example Session

```
User: Fix all my tests and make sure coverage is good

Claude: I'll run all tests, fix failures, and ensure coverage targets are met.

[Running Phase 1: Fix Test Failures]
Running all tests...
Test Results: 42 passed, 3 failed, 2 skipped

Fixing 3 test failures...
  - Fixing: services/LoopDetector.ts - should detect loops
    ✓ Fixed services/LoopDetector.test.ts
  ... (more fixes)

✓ All tests passing with 0 skips!

[Running Phase 2: Ensure Coverage Targets]
Running test coverage...
Coverage Results:
  Lines:      82% (target: 85%)
  Branches:   78% (target: 80%)
  Functions:  85% (target: 80%)
  Statements: 82% (target: 85%)

Adding tests for 2 uncovered files...
  - Adding tests for: services/analysis/LogParser.ts
    ✓ Updated services/analysis/LogParser.test.ts
  ... (more tests)

✓ All coverage targets met!

✓✓✓ SUCCESS! All tests passing and coverage targets met! ✓✓✓
```

## Configuration

The skill uses these tools (defined in `SKILL.md`):

- `Bash` - Run test commands
- `Read` - Read test and source files
- `Edit` - Fix test and implementation files
- `Write` - Create new test files
- `Grep` - Search for patterns
- `Glob` - Find test files
- `TodoWrite` - Track progress

## Files Created

1. **`.claude/skills/fix-tests-ensure-coverage/SKILL.md`**
   - The actual skill definition that Claude Code loads
   - Contains instructions for Claude on how to fix tests and ensure coverage

2. **`scripts/fix-tests-ensure-coverage.ts`**
   - Standalone script that can be run independently
   - Implements the test fixing and coverage logic

3. **`package.json`** (updated)
   - Added `fix-tests` npm script

## Next Steps

To use this skill:

1. **Restart Claude Code** (if it's currently running) - Skills are loaded on startup
2. Ask Claude to fix your tests: "Fix all my tests and ensure coverage"
3. Claude will automatically invoke this skill and execute the process

Or run the script directly:

```bash
npm run fix-tests
```

## Troubleshooting

**Skill not appearing?**
- Make sure the file is at `.claude/skills/fix-tests-ensure-coverage/SKILL.md`
- Restart Claude Code
- Check that the YAML frontmatter is valid (no tabs, proper dashes)

**Tests not fixing?**
- Check that dependencies are installed: `npm install`
- Verify database is initialized: `npx prisma db push`
- Check environment variables in `.env.local`

**Coverage not improving?**
- Ensure new tests actually execute the uncovered code
- Check for conditional code paths that aren't triggered
- Verify error handling paths are tested

## See Also

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- `vitest.config.ts` - Coverage threshold configuration
- `conductor/workflow.md` - Development workflow and TDD guidelines
