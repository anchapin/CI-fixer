import { ErrorCategory } from './types.js';

/**
 * Error Classification System for CI-Fixer
 * 
 * Classifies CI/CD errors into categories to help the agent:
 * 1. Identify root causes vs cascading failures
 * 2. Prioritize which errors to fix first
 * 3. Generate more accurate diagnoses
 * 4. Track chronological order of failures
 */

// ============================================================================
// ERROR TAXONOMY
// ============================================================================

export interface ClassifiedError {
    category: ErrorCategory;
    confidence: number;           // 0.0-1.0 confidence in classification
    rootCauseLog: string;         // The specific log line indicating root cause
    cascadingErrors: string[];    // Related errors stemming from root cause
    affectedFiles: string[];      // Files mentioned in error (for targeted fixes)
    timestamp?: string;           // When error first occurred (if extractable)
    errorMessage: string;         // Cleaned, concise error message
    suggestedAction?: string;     // Optional hint for fixing
    relatedFiles?: string[];      // NEW: Related files to edit together (from dependency analysis)
    historicalMatches?: any[];    // NEW: Similar past fixes from knowledge base
}

// ============================================================================
// ERROR PATTERNS
// ============================================================================

interface ErrorPattern {
    category: ErrorCategory;
    patterns: RegExp[];
    confidence: number;
    extractFiles?: (log: string) => string[];
    suggestedAction?: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
    // Infrastructure Errors (Command Not Found)
    {
        category: ErrorCategory.INFRASTRUCTURE,
        patterns: [
            /command not found/i,
            /not found/i,
            /is not recognized as the name of a cmdlet/i, // PowerShell
            /cannot find the path/i,
            /no such file or directory/i
        ],
        confidence: 0.9,
        suggestedAction: "Install the missing tool or ensure it is in the PATH"
    },

    // Disk Space Errors
    {
        category: ErrorCategory.DISK_SPACE,
        patterns: [
            /no space left on device/i,
            /ENOSPC/i,
            /disk quota exceeded/i,
            /not enough free space/i,
            /filesystem full/i
        ],
        confidence: 0.95,
        suggestedAction: "Add cleanup step before build (e.g., 'docker system prune -af')"
    },

    // Patch-package Failures
    {
        category: ErrorCategory.PATCH_PACKAGE_FAILURE,
        patterns: [
            /patch-package/i,
            /failed to apply patch/i,
            /checksum mismatch/i,
            /patch file is out of date/i
        ],
        confidence: 0.95,
        suggestedAction: "Regenerate patches using 'npx patch-package <package>'"
    },

    // MSW Errors
    {
        category: ErrorCategory.MSW_ERROR,
        patterns: [
            /msw/i,
            /mock service worker/i,
            /failed to intercept/i,
            /unhandled request/i,
            /worker\.start.*failed/i
        ],
        confidence: 0.95,
        suggestedAction: "Check MSW setup or clear node_modules and reinstall"
    },

    // Docker Daemon Errors
    {
        category: ErrorCategory.CONFIGURATION, // or Infrastructure
        patterns: [
            /Cannot connect to the Docker daemon/i,
            /docker daemon is not running/i,
            /docker: result of connection is not valid/i
        ],
        confidence: 0.95,
        suggestedAction: "Ensure Docker service is running or use a runner with Docker support"
    },

    // Dependency Conflicts (High Confidence)
    {
        category: ErrorCategory.DEPENDENCY_CONFLICT,
        patterns: [
            /pkg_resources\.ContextualVersionConflict/i,
            /pydantic\.errors\.PydanticImportError/i,
            /ImportError:.*cannot import name.*from.*pydantic/i,
            /ModuleNotFoundError: No module named 'pydantic\.v1'/i,
            /conflicting dependencies/i,
            /ResolutionImpossible/i
        ],
        confidence: 0.95,
        suggestedAction: "Check dependency versions and pin compatible versions in pyproject.toml or requirements.txt",
        extractFiles: (log) => {
             // Try to extract package names
             const match = log.match(/Requirement\.parse\('([^']+)'\)/);
             if (match) return [match[1].split(/[>=<]/)[0]]; // crude extraction
             return [];
        }
    },

    // HTTP 413 (Artifacts/Network)
    {
        category: ErrorCategory.NETWORK,
        patterns: [
            /413 Request Entity Too Large/i,
            /413 Payload Too Large/i,
            /entity too large/i,
            /upload.*too large/i
        ],
        confidence: 0.95,
        suggestedAction: "Increase upload limit, compress artifacts, or split upload"
    },

    // Network Errors
    {
        category: ErrorCategory.NETWORK,
        patterns: [
            /ECONNREFUSED/i,
            /ETIMEDOUT/i,
            /ENOTFOUND/i,
            /network error/i,
            /connection refused/i,
            /connection timed out/i,
            /failed to fetch/i,
            /could not resolve host/i,
            /unable to connect/i,
            /ERR_SOCKET_TIMEOUT/i
        ],
        confidence: 0.9,
        suggestedAction: "Check network connectivity or add retry logic"
    },

    // Authentication Errors
    {
        category: ErrorCategory.AUTHENTICATION,
        patterns: [
            /authentication failed/i,
            /permission denied/i,
            /unauthorized/i,
            /401/,
            /403 forbidden/i,
            /invalid credentials/i,
            /access denied/i,
            /github token.*invalid/i,
            /API rate limit exceeded/i
        ],
        confidence: 0.95,
        suggestedAction: "Verify API keys and secrets configuration"
    },

    // Dependency Errors
    {
        category: ErrorCategory.DEPENDENCY,
        patterns: [
            /cannot find module/i,
            /module not found/i,
            /ModuleNotFoundError/i,
            /missing dependency/i,
            /package.*not found/i,
            /npm ERR!/i,
            /pip install.*failed/i,
            /could not find.*requirement/i,
            /unresolved dependencies/i,
            /ERESOLVE/i,
            /peer dep.*unmet/i
        ],
        confidence: 0.85,
        extractFiles: (log) => {
            const matches = log.match(/(?:cannot find module|module not found).*?['"]([^'"]+)['"]/i);
            return matches ? [matches[1]] : [];
        },
        suggestedAction: "Install missing dependencies or fix package.json/requirements.txt"
    },

    // Syntax Errors
    {
        category: ErrorCategory.SYNTAX,
        patterns: [
            /SyntaxError/i,
            /ParseError/i,
            /unexpected token/i,
            /invalid syntax/i,
            /IndentationError/i,
            /yaml.*parse.*error/i,
            /JSON parse error/i,
            /unterminated string/i,
            /expected.*but got/i,
            /^File:.*:\d+/i
        ],
        confidence: 0.9,
        extractFiles: (log) => {
            const matches = log.match(/(?:File|at):?\s+"?([^":\s]+\.[a-z]+)"?[:\s]/i);
            return matches ? [matches[1]] : [];
        },
        suggestedAction: "Fix syntax error in the indicated file"
    },

    // Runtime Errors
    {
        category: ErrorCategory.RUNTIME,
        patterns: [
            /TypeError/i,
            /ReferenceError/i,
            /AttributeError/i,
            /NullPointerException/i,
            /cannot read propert/i,
            /undefined is not/i,
            /null.*is not.*object/i,
            /division by zero/i,
            /index out of/i,
            /segmentation fault/i
        ],
        confidence: 0.85,
        extractFiles: (log) => {
            const matches = log.match(/at\s+.*?\(([^:)]+):\d+:\d+\)/);
            return matches ? [matches[1]] : [];
        },
        suggestedAction: "Debug runtime logic in the affected code"
    },

    // Build Errors
    {
        category: ErrorCategory.BUILD,
        patterns: [
            /build failed/i,
            /compilation error/i,
            /compiler error/i,
            /tsc.*error/i,
            /webpack.*error/i,
            /vite build.*failed/i,
            /gradle build failed/i,
            /maven build failure/i,
            /error TS\d+/i,
            /BUILD FAILED/
        ],
        confidence: 0.8,
        extractFiles: (log) => {
            const matches = log.match(/([^\s:]+\.(?:ts|tsx|js|jsx|java|go|rs))(?:\(\d+,\d+\))?:\s*error/i);
            return matches ? [matches[1]] : [];
        },
        suggestedAction: "Fix compilation errors in source code"
    },

    // Test Failures
    {
        category: ErrorCategory.TEST_FAILURE,
        patterns: [
            /\d+ failing/i,
            /tests? failed/i,
            /FAIL.*test/i,
            /AssertionError/i,
            /Expected.*but received/i,
            /test.*did not pass/i,
            /×.*test/i,
            /✖.*test/i
        ],
        confidence: 0.85,
        extractFiles: (log) => {
            const matches = log.match(/FAIL\s+([^\s]+\.(?:test|spec)\.[jt]sx?)/i);
            return matches ? [matches[1]] : [];
        },
        suggestedAction: "Fix failing tests or update test expectations"
    },

    // Timeout Errors
    {
        category: ErrorCategory.TIMEOUT,
        patterns: [
            /timeout/i,
            /timed out/i,
            /exceeded.*time limit/i,
            /operation took too long/i,
            /execution time limit/i
        ],
        confidence: 0.9,
        suggestedAction: "Increase timeout or optimize slow operations",
        extractFiles: (log) => {
            // Look for test files that were running around the timeout
            // Heuristic: "Running tests in [file]" or similar output before timeout
            // For now, look for standard test patterns if present in the chunk
            const matches = log.match(/(?:test|spec)s?\/[a-zA-Z0-9_\-/]+\.(?:test|spec)\.[jt]sx?/g);
            return matches ? [...new Set(matches)] : [];
        }
    },

    // Environment Unstable (Mass Failures)
    {
        category: ErrorCategory.ENVIRONMENT_UNSTABLE,
        patterns: [
            /too many errors/i,
            /exhausted.*retries/i,
            /corrupted.*node_modules/i
        ],
        confidence: 0.8,
        suggestedAction: "Clear cache and reinstall all dependencies"
    },

    // Configuration Errors
    {
        category: ErrorCategory.CONFIGURATION,
        patterns: [
            /invalid.*configuration/i,
            /config.*error/i,
            /missing.*environment variable/i,
            /required.*not set/i,
            /invalid.*option/i,
            /unknown.*flag/i,
            /unrecognized.*argument/i
        ],
        confidence: 0.85,
        suggestedAction: "Fix configuration files or environment variables"
    }
];

// ============================================================================
// CLASSIFICATION LOGIC
// ============================================================================

/**
 * Classifies an error from CI logs into a category.
 * Uses pattern matching and heuristics to determine the error type.
 */
export function classifyError(logs: string): ClassifiedError {
    // Split logs into lines for analysis
    const lines = logs.split('\n').filter(line => line.trim().length > 0);

    // Find the first error line (chronologically first failure)
    let rootCauseLog = '';
    let category = ErrorCategory.UNKNOWN;
    let confidence = 0.0;
    let affectedFiles: string[] = [];
    let suggestedAction: string | undefined;
    let timestamp: string | undefined;

    // Try to extract timestamp from first error
    const timestampMatch = logs.match(/\[?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
    if (timestampMatch) {
        timestamp = timestampMatch[1];
    }

    // Scan lines for error patterns
    for (const line of lines) {
        // Skip non-error lines (common log prefixes)
        if (
            line.match(/^\[INFO\]/i) ||
            line.match(/^\[DEBUG\]/i) ||
            line.match(/^Running/i) ||
            line.match(/^Installing/i)
        ) {
            continue;
        }

        // Try each error pattern
        for (const pattern of ERROR_PATTERNS) {
            const matched = pattern.patterns.some(regex => regex.test(line));

            if (matched) {
                const currentPriority = getErrorPriority(category);
                const newPriority = getErrorPriority(pattern.category);
                
                let shouldSwitch = false;

                if (category === ErrorCategory.UNKNOWN) {
                    shouldSwitch = true;
                } else if (newPriority < currentPriority) {
                    shouldSwitch = true; // Better priority (lower number is higher priority)
                } else if (newPriority === currentPriority) {
                    if (pattern.confidence > confidence) {
                        shouldSwitch = true; // Same priority, better confidence
                    }
                }

                if (shouldSwitch) {
                    category = pattern.category;
                    confidence = pattern.confidence;
                    rootCauseLog = line.trim();
                    suggestedAction = pattern.suggestedAction;

                    // Reset files since we switched categories
                    affectedFiles = [];
                    if (pattern.extractFiles) {
                        const files = pattern.extractFiles(line);
                        affectedFiles = files;
                    }
                }
                // If it's the same category (or same confidence), accumulate files
                else if (pattern.category === category) {
                    if (pattern.extractFiles) {
                        const files = pattern.extractFiles(line);
                        affectedFiles = [...new Set([...affectedFiles, ...files])];
                    }
                }
            }
        }
    }


    // If no root cause found, use first error-like line
    if (!rootCauseLog) {
        const errorLine = lines.find(line =>
            line.match(/error/i) ||
            line.match(/fail/i) ||
            line.match(/exception/i)
        );
        rootCauseLog = errorLine || lines[0] || 'Unknown error';
    }

    // Extract cascading errors (errors that came after root cause)
    const cascadingErrors = extractCascadingErrors(lines, rootCauseLog);

    // Clean and format error message
    const errorMessage = cleanErrorMessage(rootCauseLog);

    // Mass failure detection (Stage 1)
    const failureCountMatch = logs.match(/(\d+) (?:failing|failed|×|✖)/gi);
    if (failureCountMatch) {
        // Extract numbers and sum them
        const totalFailures = failureCountMatch.reduce((sum, match) => {
            const num = parseInt(match.match(/\d+/)?.[0] || '0');
            return sum + num;
        }, 0);

        if (totalFailures > 20) { // Threshold for "mass failure"
            category = ErrorCategory.ENVIRONMENT_UNSTABLE;
            confidence = 0.85;
            suggestedAction = "Detected mass test failures. This often indicates a broken environment rather than code bugs.";
        }
    }

    return {
        category,
        confidence,
        rootCauseLog,
        cascadingErrors,
        affectedFiles,
        timestamp,
        errorMessage,
        suggestedAction
    };
}

/**
 * Extracts errors that occurred after the root cause.
 * These are typically consequences of the root problem.
 */
function extractCascadingErrors(lines: string[], rootCause: string): string[] {
    const rootIndex = lines.findIndex(line => line.includes(rootCause));
    if (rootIndex === -1) return [];

    const cascading: string[] = [];
    const errorKeywords = ['error', 'fail', 'exception', 'cannot', 'unable to'];

    for (let i = rootIndex + 1; i < lines.length && cascading.length < 5; i++) {
        const line = lines[i].toLowerCase();
        if (errorKeywords.some(keyword => line.includes(keyword))) {
            cascading.push(lines[i].trim());
        }
    }

    return cascading;
}

/**
 * Cleans an error message by removing timestamps, log levels, and ANSI codes.
 */
function cleanErrorMessage(message: string): string {
    return message
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-9;]*m/g, '')
        // Remove timestamps
        .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?Z?\s*/g, '')
        // Remove log level prefixes
        .replace(/^\[?(ERROR|WARN|INFO|DEBUG)\]?\s*/i, '')
        // Remove leading/trailing whitespace
        .trim();
}

// ============================================================================
// PRIORITY SCORING
// ============================================================================

/**
 * Assigns a priority score to an error category.
 * Lower scores indicate higher priority (1 = Highest, 4 = Lowest).
 */
export function getErrorPriority(category: ErrorCategory): number {
    const priorities: Record<ErrorCategory, number> = {
        // Priority 1: Environment / Dependency / Critical Infrastructure
        [ErrorCategory.DISK_SPACE]: 1,
        [ErrorCategory.AUTHENTICATION]: 1,
        [ErrorCategory.CONFIGURATION]: 1,
        [ErrorCategory.DEPENDENCY_CONFLICT]: 1,
        [ErrorCategory.ENVIRONMENT_UNSTABLE]: 1,
        [ErrorCategory.PATCH_PACKAGE_FAILURE]: 1,
        [ErrorCategory.MSW_ERROR]: 1,
        [ErrorCategory.DEPENDENCY]: 1,
        [ErrorCategory.INFRASTRUCTURE]: 1,
        
        // Priority 2: Linting / Build / Syntax
        [ErrorCategory.SYNTAX]: 2,
        [ErrorCategory.BUILD]: 2,
        
        // Priority 3: Runtime / Infrastructure (transient)
        [ErrorCategory.RUNTIME]: 3,
        [ErrorCategory.NETWORK]: 3,
        [ErrorCategory.TIMEOUT]: 3,
        
        // Priority 4: Test Failures (Logic)
        [ErrorCategory.TEST_FAILURE]: 4,
        
        // Priority 5: Unknown
        [ErrorCategory.UNKNOWN]: 5
    };

    return priorities[category] || 5;
}

/**
 * Compares two classified errors and returns the one with higher priority.
 * Used to identify which error to fix first.
 */
export function selectPrimaryError(
    error1: ClassifiedError,
    error2: ClassifiedError
): ClassifiedError {
    const priority1 = getErrorPriority(error1.category);
    const priority2 = getErrorPriority(error2.category);

    // Lower number = Higher priority
    if (priority1 < priority2) return error1;
    if (priority2 < priority1) return error2;

    // If same priority, prefer higher confidence
    return error1.confidence >= error2.confidence ? error1 : error2;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Formats a classified error into a human-readable summary for LLM context.
 */
export function formatErrorSummary(error: ClassifiedError): string {
    const lines: string[] = [
        '=== Error Classification ===',
        `Category: ${error.category.toUpperCase()}`,
        `Confidence: ${(error.confidence * 100).toFixed(0)}%`,
        `Priority: ${getErrorPriority(error.category)}/4`,
        '',
        `Error Message: ${error.errorMessage}`,
        ''
    ];

    if (error.affectedFiles.length > 0) {
        lines.push(`Affected Files: ${error.affectedFiles.join(', ')}`);
        lines.push('');
    }

    if (error.suggestedAction) {
        lines.push(`Suggested Action: ${error.suggestedAction}`);
        lines.push('');
    }

    if (error.cascadingErrors.length > 0) {
        lines.push('Cascading Errors (likely consequences):');
        error.cascadingErrors.forEach(err => {
            lines.push(`  - ${err.substring(0, 100)}${err.length > 100 ? '...' : ''}`);
        });
    }

    return lines.join('\n');
}

/**
 * Checks if an error is likely a cascading failure based on its relationship to another error.
 */
export function isCascadingError(
    potentialCascade: ClassifiedError,
    rootError: ClassifiedError
): boolean {
    // If timestamps available, cascading error must come after root
    if (potentialCascade.timestamp && rootError.timestamp) {
        if (potentialCascade.timestamp <= rootError.timestamp) {
            return false;
        }
    }

    // Certain categories are never cascading (they're always root causes)
    const alwaysRootCategories = [
        ErrorCategory.DISK_SPACE,
        ErrorCategory.AUTHENTICATION,
        ErrorCategory.CONFIGURATION
    ];

    if (alwaysRootCategories.includes(potentialCascade.category)) {
        return false;
    }

    // If same files affected, likely related
    const sharedFiles = potentialCascade.affectedFiles.filter(file =>
        rootError.affectedFiles.includes(file)
    );

    if (sharedFiles.length > 0) {
        return true;
    }

    // If root is dependency error, build/runtime errors are likely cascading
    if (
        rootError.category === ErrorCategory.DEPENDENCY &&
        (potentialCascade.category === ErrorCategory.BUILD ||
            potentialCascade.category === ErrorCategory.RUNTIME)
    ) {
        return true;
    }

    // If root is syntax error, build errors are likely cascading
    if (
        rootError.category === ErrorCategory.SYNTAX &&
        potentialCascade.category === ErrorCategory.BUILD
    ) {
        return true;
    }

    return false;
}

// ============================================================================
// ENHANCED CLASSIFICATION WITH KNOWLEDGE BASE
// ============================================================================

/**
 * Enhanced classification that integrates with knowledge base and dependency analysis.
 * This provides historical context and related file suggestions.
 */
export async function classifyErrorWithHistory(
    logs: string,
    profile?: any // RepositoryProfile from validation.ts
): Promise<ClassifiedError> {
    // Start with basic classification
    const classified = classifyError(logs);

    // If we have a profile with file relationships, find related files
    if (profile && profile.fileRelationships && classified.affectedFiles.length > 0) {
        const relatedFilesSet = new Set<string>();

        for (const file of classified.affectedFiles) {
            const relationship = profile.fileRelationships.get(file);
            if (relationship) {
                // Add dependencies
                relationship.dependencies.forEach((dep: string) => relatedFilesSet.add(dep));
                // Add test files
                relationship.testFiles.forEach((test: string) => relatedFilesSet.add(test));
            }
        }

        classified.relatedFiles = Array.from(relatedFilesSet);
    }

    // Try to find similar historical fixes (async operation)
    try {
        const { findSimilarFixes } = await import('./services/knowledge-base.js');
        const matches = await findSimilarFixes(classified, 3);
        if (matches.length > 0) {
            classified.historicalMatches = matches;
        }
    } catch (e) {
        // Knowledge base not available or error - gracefully degrade
        console.debug('Knowledge base lookup failed:', e);
    }

    return classified;
}
