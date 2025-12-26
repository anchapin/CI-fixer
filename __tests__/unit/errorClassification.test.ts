import { describe, it, expect } from 'vitest';
import { ErrorCategory } from '../../types.js';
import {
    classifyError,
    getErrorPriority,
    selectPrimaryError,
    isCascadingError,
    formatErrorSummary,
    type ClassifiedError
} from '../../errorClassification.js';

describe('Error Classification', () => {
    describe('classifyError', () => {
        it('should classify disk space error', () => {
            const logs = `
[ERROR] npm ci failed
npm ERR! code ENOSPC
npm ERR! syscall write
npm ERR! errno -28
npm ERR! write ENOSPC: no space left on device, write
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.DISK_SPACE);
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            expect(result.errorMessage).toMatch(/no space left|ENOSPC/i);
            expect(result.suggestedAction).toContain('cleanup');
        });

        it('should classify network error', () => {
            const logs = `
Error: connect ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.NETWORK);
            expect(result.confidence).toBeGreaterThanOrEqual(0.85);
            expect(result.errorMessage).toContain('ECONNREFUSED');
        });

        it('should classify authentication error', () => {
            const logs = `
Error: GitHub API request failed
statusCode: 401
message: Unauthorized - Bad credentials
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.AUTHENTICATION);
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('should classify dependency error and extract module name', () => {
            const logs = `
Error: Cannot find module '@octokit/rest'
Require stack:
- /home/runner/work/repo/src/services.ts
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.DEPENDENCY);
            expect(result.confidence).toBeGreaterThanOrEqual(0.8);
            expect(result.affectedFiles.length).toBeGreaterThan(0);
        });

        it('should classify syntax error and extract file', () => {
            const logs = `
SyntaxError: Unexpected token '}'
    at Module._compile (node:internal/modules/cjs/loader:1358:18)
    at Object..js (node:internal/modules/cjs/loader:1416:10)
File: src/components/Button.tsx:45:3
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.SYNTAX);
            expect(result.confidence).toBeGreaterThanOrEqual(0.85);
            expect(result.affectedFiles).toContain('src/components/Button.tsx');
        });

        it('should classify runtime error', () => {
            const logs = `
TypeError: Cannot read properties of undefined (reading 'map')
    at renderUsers (src/App.tsx:42:18)
    at App (src/App.tsx:120:5)
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.RUNTIME);
            expect(result.confidence).toBeGreaterThanOrEqual(0.8);
        });

        it('should classify build error', () => {
            const logs = `
error TS2322: Type 'string' is not assignable to type 'number'.
src/utils/math.ts(15,5): error TS2322
BUILD FAILED
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.BUILD);
            expect(result.affectedFiles).toContain('src/utils/math.ts');
        });

        it('should classify test failure', () => {
            const logs = `
 FAIL  __tests__/api.test.ts
  ● User API › should fetch user data

    AssertionError: expected 'John' but received 'Jane'
    
  Tests: 1 failed, 5 passed, 6 total
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.TEST_FAILURE);
            expect(result.affectedFiles).toContain('__tests__/api.test.ts');
        });

        it('should classify timeout error', () => {
            const logs = `
Error: Test exceeded timeout of 5000ms
  at Timeout._onTimeout (vitest/dist/vendor-utils.js:1234:5)
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.TIMEOUT);
        });

        it('should classify configuration error', () => {
            const logs = `
Error: Required environment variable DATABASE_URL is not set
Configuration validation failed
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.CONFIGURATION);
        });

        it('should extract cascading errors', () => {
            const logs = `
npm ERR! code ENOSPC
npm ERR! no space left on device
npm ERR! A complete log of this run can be found in:
npm ERR! Cannot write to package-lock.json
npm ERR! Build failed with exit code 1
      `;

            const result = classifyError(logs);

            expect(result.cascadingErrors.length).toBeGreaterThan(0);
            expect(result.cascadingErrors.some(err => err.includes('Cannot write'))).toBe(true);
        });

        it('should clean error messages', () => {
            const logs = `
[ERROR] 2025-01-01T10:30:45.123Z npm ci failed: no space left on device
      `;

            const result = classifyError(logs);

            // Should remove timestamp and log level
            expect(result.errorMessage).not.toContain('2025-01-01');
            expect(result.errorMessage).not.toContain('[ERROR]');
            expect(result.errorMessage).toContain('npm ci failed');
        });

        it('should handle unknown errors gracefully', () => {
            const logs = `
Some weird error that doesn't match any pattern
This is just random text
      `;

            const result = classifyError(logs);

            expect(result.category).toBe(ErrorCategory.UNKNOWN);
            expect(result.confidence).toBeLessThan(0.9);
            expect(result.rootCauseLog).toBeTruthy();
        });
    });

    describe('getErrorPriority', () => {
        it('should assign highest priority (1) to disk space errors', () => {
            expect(getErrorPriority(ErrorCategory.DISK_SPACE)).toBe(1);
        });

        it('should assign highest priority (1) to auth errors', () => {
            expect(getErrorPriority(ErrorCategory.AUTHENTICATION)).toBe(1);
        });

        it('should assign lower priority (higher number) to test failures', () => {
            const testPriority = getErrorPriority(ErrorCategory.TEST_FAILURE); // 4
            const diskPriority = getErrorPriority(ErrorCategory.DISK_SPACE); // 1
            expect(testPriority).toBeGreaterThan(diskPriority);
        });

        it('should assign lowest priority (5) to unknown errors', () => {
            expect(getErrorPriority(ErrorCategory.UNKNOWN)).toBe(5);
        });

        it('should have consistent priority ordering', () => {
            // Ordered from Highest Priority (1) to Lowest (5)
            const priorities = [
                ErrorCategory.DISK_SPACE,      // 1
                ErrorCategory.AUTHENTICATION,  // 1
                ErrorCategory.CONFIGURATION,   // 1
                ErrorCategory.DEPENDENCY,      // 1
                ErrorCategory.SYNTAX,          // 2
                ErrorCategory.BUILD,           // 2
                ErrorCategory.RUNTIME,         // 3
                ErrorCategory.NETWORK,         // 3
                ErrorCategory.TEST_FAILURE,    // 4
                ErrorCategory.UNKNOWN          // 5
            ].map(cat => getErrorPriority(cat));

            // Each priority should be greater than or equal to the previous (1, 1, 1, 1, 2, 2, 3, 3, 4, 5)
            for (let i = 1; i < priorities.length; i++) {
                expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
            }
        });
    });

    describe('selectPrimaryError', () => {
        it('should select higher priority error (lower number)', () => {
            const diskError: ClassifiedError = {
                category: ErrorCategory.DISK_SPACE,
                confidence: 0.9,
                rootCauseLog: 'no space left',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'no space left on device'
            };

            const testError: ClassifiedError = {
                category: ErrorCategory.TEST_FAILURE,
                confidence: 0.9,
                rootCauseLog: 'test failed',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'test failed'
            };

            const primary = selectPrimaryError(diskError, testError);
            expect(primary.category).toBe(ErrorCategory.DISK_SPACE);
        });

        it('should select higher confidence when same priority', () => {
            const error1: ClassifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.95,
                rootCauseLog: 'syntax error',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'syntax error'
            };

            const error2: ClassifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.7,
                rootCauseLog: 'another syntax error',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'another syntax error'
            };

            const primary = selectPrimaryError(error1, error2);
            expect(primary.confidence).toBe(0.95);
        });
    });

    describe('formatErrorSummary', () => {
        it('should format error summary with all details', () => {
            const error: ClassifiedError = {
                category: ErrorCategory.DISK_SPACE,
                confidence: 0.95,
                rootCauseLog: 'ENOSPC: no space left on device',
                cascadingErrors: ['npm install failed', 'build failed'],
                affectedFiles: ['package-lock.json'],
                errorMessage: 'no space left on device',
                suggestedAction: 'Add cleanup step',
                timestamp: '2025-01-01T10:00:00'
            };

            const summary = formatErrorSummary(error);

            expect(summary).toContain('Category: DISK_SPACE');
            expect(summary).toContain('Confidence: 95%');
            expect(summary).toContain('Priority: 1/4');
            expect(summary).toContain('no space left on device');
            expect(summary).toContain('package-lock.json');
            expect(summary).toContain('Add cleanup step');
            expect(summary).toContain('Cascading Errors');
            expect(summary).toContain('npm install failed');
        });

        it('should handle minimal error info', () => {
            const error: ClassifiedError = {
                category: ErrorCategory.UNKNOWN,
                confidence: 0.5,
                rootCauseLog: 'unknown error',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'unknown error'
            };

            const summary = formatErrorSummary(error);

            expect(summary).toContain('Category: UNKNOWN');
            expect(summary).toContain('unknown error');
            expect(summary).not.toContain('Affected Files');
            expect(summary).not.toContain('Suggested Action');
        });
    });

    describe('isCascadingError', () => {
        it('should identify build error cascading from dependency error', () => {
            const rootError: ClassifiedError = {
                category: ErrorCategory.DEPENDENCY,
                confidence: 0.9,
                rootCauseLog: 'cannot find module',
                cascadingErrors: [],
                affectedFiles: ['src/app.ts'],
                errorMessage: 'cannot find module'
            };

            const buildError: ClassifiedError = {
                category: ErrorCategory.BUILD,
                confidence: 0.8,
                rootCauseLog: 'compilation failed',
                cascadingErrors: [],
                affectedFiles: ['src/app.ts'],
                errorMessage: 'compilation failed'
            };

            expect(isCascadingError(buildError, rootError)).toBe(true);
        });

        it('should not identify disk space as cascading', () => {
            const rootError: ClassifiedError = {
                category: ErrorCategory.TEST_FAILURE,
                confidence: 0.9,
                rootCauseLog: 'test failed',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'test failed'
            };

            const diskError: ClassifiedError = {
                category: ErrorCategory.DISK_SPACE,
                confidence: 0.95,
                rootCauseLog: 'no space left',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'no space left'
            };

            expect(isCascadingError(diskError, rootError)).toBe(false);
        });

        it('should identify build error cascading from syntax error', () => {
            const syntaxError: ClassifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'unexpected token',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'unexpected token'
            };

            const buildError: ClassifiedError = {
                category: ErrorCategory.BUILD,
                confidence: 0.8,
                rootCauseLog: 'build failed',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'build failed'
            };

            expect(isCascadingError(buildError, syntaxError)).toBe(true);
        });

        it('should use timestamp when available', () => {
            const earlierError: ClassifiedError = {
                category: ErrorCategory.NETWORK,
                confidence: 0.9,
                rootCauseLog: 'connection refused',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'connection refused',
                timestamp: '2025-01-01T10:00:00'
            };

            const laterError: ClassifiedError = {
                category: ErrorCategory.RUNTIME,
                confidence: 0.8,
                rootCauseLog: 'null reference',
                cascadingErrors: [],
                affectedFiles: [],
                errorMessage: 'null reference',
                timestamp: '2025-01-01T10:00:01'
            };

            // Later error could be cascading from earlier
            expect(isCascadingError(laterError, earlierError)).toBe(false); // No clear relationship

            // earlier happening after later doesn't make sense
            expect(isCascadingError(earlierError, laterError)).toBe(false);
        });

        it('should identify related errors by affected files', () => {
            const error1: ClassifiedError = {
                category: ErrorCategory.SYNTAX,
                confidence: 0.9,
                rootCauseLog: 'parse error',
                cascadingErrors: [],
                affectedFiles: ['src/api.ts'],
                errorMessage: 'parse error'
            };

            const error2: ClassifiedError = {
                category: ErrorCategory.BUILD,
                confidence: 0.8,
                rootCauseLog: 'build failed',
                cascadingErrors: [],
                affectedFiles: ['src/api.ts', 'src/utils.ts'],
                errorMessage: 'build failed'
            };

            expect(isCascadingError(error2, error1)).toBe(true);
        });
    });

    describe('Dependency Conflict Detection', () => {
        it('should classify pkg_resources.ContextualVersionConflict', () => {
            const logs = `
Traceback (most recent call last):
  File "/usr/local/bin/crewai", line 5, in <module>
    from crewai.cli import main
  File "/usr/local/lib/python3.10/site-packages/crewai/__init__.py", line 5, in <module>
    from crewai.agent import Agent
  File "/usr/local/lib/python3.10/site-packages/crewai/agent.py", line 4, in <module>
    from pydantic import BaseModel, Field, PrivateAttr, root_validator
  File "/usr/local/lib/python3.10/site-packages/pydantic/__init__.py", line 2, in <module>
    from . import dataclasses
  File "/usr/local/lib/python3.10/site-packages/pydantic/dataclasses.py", line 3, in <module>
    from ._internal import typing_extra
  File "/usr/local/lib/python3.10/site-packages/pydantic/_internal/typing_extra.py", line 3, in <module>
    from typing import Annotated, Any, Callable, ForwardRef, Literal, TypeVar, Union
ImportError: cannot import name 'Annotated' from 'typing' (/usr/local/lib/python3.10/typing.py)
ERROR: pkg_resources.ContextualVersionConflict: (pydantic 1.10.13 (/usr/local/lib/python3.10/site-packages), Requirement.parse('pydantic>=2.0.0'), {'crewai'})
`;
            const result = classifyError(logs);
            // Casting to any to avoid TS error before implementation
            expect(result.category).toBe(ErrorCategory.DEPENDENCY_CONFLICT);
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            expect(result.errorMessage).toContain('ContextualVersionConflict');
        });

        it('should classify Pydantic version mismatch ImportError', () => {
            const logs = `
Traceback (most recent call last):
  File "main.py", line 1, in <module>
    from crewai import Agent
  File "/usr/local/lib/python3.10/site-packages/crewai/__init__.py", line 1, in <module>
    from .agent import Agent
  File "/usr/local/lib/python3.10/site-packages/crewai/agent.py", line 3, in <module>
    from pydantic.v1 import BaseModel
ModuleNotFoundError: No module named 'pydantic.v1'
`;
            // This suggests they have Pydantic v1 installed but code tries to use v2 compatibility layer or vice versa
            // Actually 'pydantic.v1' is available in Pydantic V2 to support V1 code.
            // If it fails, it means they likely have Pydantic V1 installed which doesn't have .v1 submodule.
            
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.DEPENDENCY_CONFLICT);
        });
    });

    describe('Environmental Error Detection', () => {
        it('should classify patch-package failure', () => {
            const logs = `
error: patch-package: failed to apply patch for @mui/material
  checksum mismatch: expected abc, got xyz
`;
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.PATCH_PACKAGE_FAILURE);
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('should classify MSW error', () => {
            const logs = `
Error: [MSW] Failed to intercept request: connection refused
    at MockServiceWorker.start
`;
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.MSW_ERROR);
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
        });

        it('should detect mass test failures as environment unstable', () => {
            const logs = `
FAIL src/components/Button.test.tsx
FAIL src/utils/math.test.ts
FAIL src/hooks/useUser.test.ts
... (many more)
Tests: 25 failed, 2 passed, 27 total
`;
            const result = classifyError(logs);
            expect(result.category).toBe(ErrorCategory.ENVIRONMENT_UNSTABLE);
            expect(result.confidence).toBe(0.85);
        });
    });
});
