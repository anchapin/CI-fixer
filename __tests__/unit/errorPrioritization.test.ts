
import { describe, it, expect } from 'vitest';
import { 
    ErrorCategory, 
    ClassifiedError, 
    selectPrimaryError, 
    getErrorPriority,
    classifyError
} from '../../errorClassification.js';

describe('Error Prioritization Hierarchy', () => {
    
    // Helper to create mock errors
    const createError = (category: ErrorCategory, confidence = 0.9): ClassifiedError => ({
        category,
        confidence,
        rootCauseLog: 'mock log',
        cascadingErrors: [],
        affectedFiles: [],
        errorMessage: 'mock message'
    });

    describe('Priority Values (Ascending Order)', () => {
        // ... (Existing tests)
        it('should assign Priority 1 (Highest) to Environment/Dependency errors', () => {
            // Note: We check if it is <= 1 because 1 is top priority
            expect(getErrorPriority(ErrorCategory.DEPENDENCY)).toBeLessThanOrEqual(1);
            expect(getErrorPriority(ErrorCategory.DEPENDENCY_CONFLICT)).toBeLessThanOrEqual(1);
            expect(getErrorPriority(ErrorCategory.DISK_SPACE)).toBeLessThanOrEqual(1);
        });

        it('should assign Priority 2 to Linting/Build errors', () => {
            const buildPrio = getErrorPriority(ErrorCategory.BUILD);
            const depPrio = getErrorPriority(ErrorCategory.DEPENDENCY);
            
            // Build (2) should be > Dependency (1) in numerical value (lower is better)
            expect(buildPrio).toBeGreaterThan(depPrio);
            expect(buildPrio).toBeLessThanOrEqual(2);
        });

        it('should assign Priority 3 to Runtime/Infrastructure errors', () => {
            const runtimePrio = getErrorPriority(ErrorCategory.RUNTIME);
            const buildPrio = getErrorPriority(ErrorCategory.BUILD);

            // Runtime (3) > Build (2)
            expect(runtimePrio).toBeGreaterThan(buildPrio);
            expect(runtimePrio).toBeLessThanOrEqual(3);
        });

        it('should assign Priority 4 (Lowest) to Test Assertion failures', () => {
            const testPrio = getErrorPriority(ErrorCategory.TEST_FAILURE);
            const runtimePrio = getErrorPriority(ErrorCategory.RUNTIME);

            // Test (4) > Runtime (3)
            expect(testPrio).toBeGreaterThan(runtimePrio);
            expect(testPrio).toBeLessThanOrEqual(4);
        });
    });

    describe('selectPrimaryError', () => {
        // ... (Existing tests)
        it('should prefer Dependency error over Test Failure', () => {
            const depError = createError(ErrorCategory.DEPENDENCY);
            const testError = createError(ErrorCategory.TEST_FAILURE);

            const selected = selectPrimaryError(depError, testError);
            expect(selected.category).toBe(ErrorCategory.DEPENDENCY);
        });

        it('should prefer Build error over Runtime error', () => {
            const buildError = createError(ErrorCategory.BUILD);
            const runtimeError = createError(ErrorCategory.RUNTIME);

            const selected = selectPrimaryError(buildError, runtimeError);
            expect(selected.category).toBe(ErrorCategory.BUILD);
        });

        it('should prefer lower priority value (higher importance)', () => {
            const highPrio = createError(ErrorCategory.DISK_SPACE); // Should be 1
            const lowPrio = createError(ErrorCategory.TEST_FAILURE); // Should be 4

            const selected = selectPrimaryError(highPrio, lowPrio);
            expect(selected.category).toBe(ErrorCategory.DISK_SPACE);
        });
    });

    describe('Integration: classifyError with Mixed Logs', () => {
        it('should prioritize Dependency Error over Test Failure in same log', () => {
            const logs = `
FAIL src/components/Button.test.tsx
  ● Button › should render
    AssertionError: expected true to be false

...

Error: Cannot find module 'react'
Require stack:
- /home/runner/work/src/index.tsx
`;
            // Test Failure (Prio 4) appears first. Dependency (Prio 1) appears later.
            // Both have high confidence patterns.
            // We expect Dependency to win.

            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.DEPENDENCY);
        });

        it('should prioritize Syntax Error over Test Failure', () => {
             const logs = `
FAIL src/utils.test.ts
  ● Utils › should work
    expected 1 to be 2

src/utils.ts:10:5 - error TS1005: ';' expected.
`;
            // Test Failure (Prio 4) vs Syntax/Build (Prio 2).
            // Syntax should win.

            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.BUILD);
        });
    });
});
