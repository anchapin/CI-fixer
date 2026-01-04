#!/usr/bin/env node
/**
 * Test Fixer & Coverage Enforcer
 *
 * Automatically:
 * 1. Runs all tests (unit + integration + e2e)
 * 2. Analyzes failures and fixes them iteratively until 100% pass with 0 skips
 * 3. Runs test coverage
 * 4. Identifies uncovered files and branches
 * 5. Generates/updates tests to meet coverage targets (85% lines, 80% branches)
 *
 * Usage:
 *   node scripts/fix-tests-ensure-coverage.ts
 *   npm run fix-tests
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Configuration
const COVERAGE_TARGETS = {
  lines: 85,
  branches: 80,
  functions: 80,
  statements: 85
};

const MAX_FIX_ITERATIONS = 10;
const MAX_COVERAGE_ITERATIONS = 5;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command: string, options: any = {}): string {
  try {
    return execSync(command, {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      ...options
    });
  } catch (error: any) {
    if (options.ignoreError) return error.stdout || '';
    throw error;
  }
}

function parseTestResults(output: string): {
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ file: string; test: string; error: string }>;
} {
  const result = {
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [] as Array<{ file: string; test: string; error: string }>
  };

  // Parse vitest output
  const lines = output.split('\n');

  for (const line of lines) {
    // Match: "Test Files  10 passed (10)" or similar
    const testFileMatch = line.match(/Test Files\s+(\d+)\s+(passed|failed|skipped)/);
    if (testFileMatch) {
      const count = parseInt(testFileMatch[1]);
      const status = testFileMatch[2];
      if (status === 'passed') result.passed += count;
      else if (status === 'failed') result.failed += count;
      else if (status === 'skipped') result.skipped += count;
    }

    // Match: "Tests  50 passed (10)" etc.
    const testMatch = line.match(/Tests\s+(\d+)\s+(passed|failed|skipped)/);
    if (testMatch) {
      const count = parseInt(testMatch[1]);
      const status = testMatch[2];
      if (status === 'passed') result.passed += count;
      else if (status === 'failed') result.failed += count;
      else if (status === 'skipped') result.skipped += count;
    }
  }

  // Extract failure details
  const failureBlocks = output.split(/\n●[^●]+?\n(?=●|\n*$)/s);
  for (const block of failureBlocks) {
    const fileMatch = block.match(/FAIL\s+(.+?)\.test\.(ts|js)/);
    const testMatch = block.match(/●\s+(.+)/);
    const errorMatch = block.match(/Error:\s+(.+)/);

    if (fileMatch && testMatch) {
      result.failures.push({
        file: fileMatch[1],
        test: testMatch[1],
        error: errorMatch?.[1] || 'Unknown error'
      });
    }
  }

  return result;
}

function parseCoverageResults(output: string): {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  uncoveredFiles: Array<{ file: string; lines: number; branches: number }>;
} {
  const result = {
    lines: 0,
    branches: 0,
    functions: 0,
    statements: 0,
    uncoveredFiles: [] as Array<{ file: string; lines: number; branches: number }>
  };

  const lines = output.split('\n');
  let inFileTable = false;

  for (const line of lines) {
    // Parse overall percentages
    const overallMatch = line.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
    if (overallMatch) {
      result.statements = parseFloat(overallMatch[1]);
      result.branches = parseFloat(overallMatch[2]);
      result.functions = parseFloat(overallMatch[3]);
      result.lines = parseFloat(overallMatch[4]);
    }

    // Parse file-level coverage
    if (line.includes('---')) {
      inFileTable = true;
      continue;
    }
    if (inFileTable && line.trim() === '') {
      inFileTable = false;
      continue;
    }
    if (inFileTable) {
      const fileMatch = line.match(/(.+\.ts)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
      if (fileMatch) {
        const coverage = parseFloat(fileMatch[2]);
        if (coverage < COVERAGE_TARGETS.lines) {
          result.uncoveredFiles.push({
            file: fileMatch[1],
            lines: coverage,
            branches: parseFloat(fileMatch[3])
          });
        }
      }
    }
  }

  return result;
}

async function generateTestFixPrompt(failure: {
  file: string;
  test: string;
  error: string;
}): Promise<string> {
  const testFilePath = `${ROOT}/${failure.file}.test.ts`;

  let testContent = '';
  if (existsSync(testFilePath)) {
    testContent = readFileSync(testFilePath, 'utf-8');
  }

  return `
You are fixing a failing test. Here are the details:

Test File: ${failure.file}.test.ts
Test Name: ${failure.test}
Error: ${failure.error}

Current Test Content:
\`\`\`typescript
${testContent || '<no existing test file>'}
\`\`\`

Task:
1. Analyze the error and understand what's failing
2. Read the source file (${failure.file}.ts) to understand the implementation
3. Fix the test OR fix the implementation based on what's actually broken
4. Ensure the fix doesn't break other tests

Provide the fixed file content wrapped in \`\`\`typescript ... \`\`\` blocks.
`;
}

async function generateCoverageTestPrompt(uncoveredFile: {
  file: string;
  lines: number;
  branches: number;
}): Promise<string> {
  const sourcePath = `${ROOT}/${uncoveredFile}`;
  const testPath = sourcePath.replace('.ts', '.test.ts');

  let sourceContent = '';
  let testContent = '';

  if (existsSync(sourcePath)) {
    sourceContent = readFileSync(sourcePath, 'utf-8');
  }

  if (existsSync(testPath)) {
    testContent = readFileSync(testPath, 'utf-8');
  }

  return `
You are adding tests to improve code coverage. Here are the details:

File: ${uncoveredFile}
Current Coverage:
- Lines: ${uncovered.lines}% (target: ${COVERAGE_TARGETS.lines}%)
- Branches: ${uncovered.branches}% (target: ${COVERAGE_TARGETS.branches}%)

Source File Content:
\`\`\`typescript
${sourceContent}
\`\`\`

Existing Test Content:
\`\`\`typescript
${testContent || '<no existing tests>'}
\`\`\`

Task:
1. Identify untested functions, edge cases, and branch conditions
2. Add comprehensive tests to cover the missing code paths
3. Ensure tests are meaningful (not just hitting coverage for the sake of it)
4. Follow the existing test patterns in the codebase

Provide the updated test file content wrapped in \`\`\`typescript ... \`\`\` blocks.
`;
}

async function callLLM(prompt: string): Promise<string> {
  // This would need to call the LLM service
  // For now, return a placeholder
  log('LLM call needed - implement with your LLM provider', 'yellow');
  return '';
}

function applyFix(filePath: string, content: string) {
  const fullPath = join(ROOT, filePath);
  writeFileSync(fullPath, content, 'utf-8');
}

async function fixTests() {
  log('\n=== Phase 1: Fix Test Failures ===\n', 'cyan');

  let iteration = 0;
  let allPassing = false;

  while (iteration < MAX_FIX_ITERATIONS && !allPassing) {
    iteration++;
    log(`\nIteration ${iteration}/${MAX_FIX_ITERATIONS}`, 'blue');

    // Run tests
    log('Running all tests...', 'blue');
    const testOutput = exec('npm test -- --run --reporter=verbose 2>&1', {
      ignoreError: true
    });

    const results = parseTestResults(testOutput);

    log(`Test Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`,
      results.failed === 0 && results.skipped === 0 ? 'green' : 'yellow'
    );

    if (results.failed === 0 && results.skipped === 0) {
      allPassing = true;
      log('✓ All tests passing with 0 skips!', 'green');
      break;
    }

    // Fix failures
    if (results.failures.length > 0) {
      log(`\nFixing ${results.failures.length} test failures...`, 'yellow');

      for (const failure of results.failures.slice(0, 3)) { // Limit to 3 per iteration
        log(`  - Fixing: ${failure.file} - ${failure.test}`, 'yellow');

        const prompt = await generateTestFixPrompt(failure);
        const fixedContent = await callLLM(prompt);

        if (fixedContent) {
          const testFilePath = `${failure.file}.test.ts`;
          applyFix(testFilePath, fixedContent);
          log(`    ✓ Fixed ${testFilePath}`, 'green');
        }
      }
    }

    // Unskip tests
    if (results.skipped > 0) {
      log(`\nAttempting to unskip ${results.skipped} tests...`, 'yellow');
      // TODO: Implement skip removal logic
    }
  }

  if (!allPassing) {
    log('\n⚠ Max iterations reached. Some tests may still be failing.', 'yellow');
  }

  return allPassing;
}

async function ensureCoverage() {
  log('\n=== Phase 2: Ensure Coverage Targets ===\n', 'cyan');

  let iteration = 0;
  let coverageMet = false;

  while (iteration < MAX_COVERAGE_ITERATIONS && !coverageMet) {
    iteration++;
    log(`\nIteration ${iteration}/${MAX_COVERAGE_ITERATIONS}`, 'blue');

    // Run coverage
    log('Running test coverage...', 'blue');
    const coverageOutput = exec('npm run test:coverage -- --run 2>&1', {
      ignoreError: true
    });

    const results = parseCoverageResults(coverageOutput);

    log(`Coverage Results:`, 'blue');
    log(`  Lines:      ${results.lines}% (target: ${COVERAGE_TARGETS.lines}%)`,
      results.lines >= COVERAGE_TARGETS.lines ? 'green' : 'red'
    );
    log(`  Branches:   ${results.branches}% (target: ${COVERAGE_TARGETS.branches}%)`,
      results.branches >= COVERAGE_TARGETS.branches ? 'green' : 'red'
    );
    log(`  Functions:  ${results.functions}% (target: ${COVERAGE_TARGETS.functions}%)`,
      results.functions >= COVERAGE_TARGETS.functions ? 'green' : 'red'
    );
    log(`  Statements: ${results.statements}% (target: ${COVERAGE_TARGETS.statements}%)`,
      results.statements >= COVERAGE_TARGETS.statements ? 'green' : 'red'
    );

    const targetsMet =
      results.lines >= COVERAGE_TARGETS.lines &&
      results.branches >= COVERAGE_TARGETS.branches &&
      results.functions >= COVERAGE_TARGETS.functions &&
      results.statements >= COVERAGE_TARGETS.statements;

    if (targetsMet) {
      coverageMet = true;
      log('\n✓ All coverage targets met!', 'green');
      break;
    }

    // Add tests for uncovered files
    if (results.uncoveredFiles.length > 0) {
      log(`\nAdding tests for ${results.uncoveredFiles.length} uncovered files...`, 'yellow');

      for (const uncovered of results.uncoveredFiles.slice(0, 3)) { // Limit to 3 per iteration
        log(`  - Adding tests for: ${uncovered.file}`, 'yellow');

        const prompt = await generateCoverageTestPrompt(uncovered);
        const newTestContent = await callLLM(prompt);

        if (newTestContent) {
          const testFilePath = uncovered.file.replace('.ts', '.test.ts');
          applyFix(testFilePath, newTestContent);
          log(`    ✓ Updated ${testFilePath}`, 'green');
        }
      }
    }
  }

  if (!coverageMet) {
    log('\n⚠ Max iterations reached. Coverage targets may not be fully met.', 'yellow');
  }

  return coverageMet;
}

async function main() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║   Test Fixer & Coverage Enforcer                            ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');

  const startTime = Date.now();

  try {
    // Phase 1: Fix all test failures
    const testsPassing = await fixTests();

    // Phase 2: Ensure coverage targets
    const coverageMet = await ensureCoverage();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Final summary
    log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
    log('║   Final Summary                                            ║', 'cyan');
    log('╚════════════════════════════════════════════════════════════╝', 'cyan');

    log(`\nDuration: ${duration}s`, 'blue');
    log(`Tests Passing: ${testsPassing ? '✓' : '✗'}`, testsPassing ? 'green' : 'red');
    log(`Coverage Met: ${coverageMet ? '✓' : '✗'}`, coverageMet ? 'green' : 'red');

    if (testsPassing && coverageMet) {
      log('\n✓✓✓ SUCCESS! All tests passing and coverage targets met! ✓✓✓\n', 'green');
      process.exit(0);
    } else {
      log('\n⚠ Partial success. Review the output above for details.\n', 'yellow');
      process.exit(1);
    }

  } catch (error: any) {
    log(`\n✗ Error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

main();
