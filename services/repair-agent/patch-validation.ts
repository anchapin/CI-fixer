/**
 * Patch Validation Module
 * Implements automated validation of patch candidates
 * Based on RepairAgent paper (arXiv:2403.17134)
 */

import { AppConfig } from '../../types.js';
import { PatchCandidate } from './patch-generation.js';
import { SandboxEnvironment } from '../../sandbox.js';

export interface ValidationResult {
    patchId: string;
    passed: boolean;
    testsPassed: boolean;
    syntaxValid: boolean;
    staticAnalysisPassed: boolean;
    executionTime: number;
    errorMessage?: string;
    details: {
        testsRun: number;
        testsFailed: number;
        lintErrors: number;
        typeErrors: number;
    };
}

export interface ValidationCriteria {
    requireTestsPass: boolean;
    requireSyntaxValid: boolean;
    requireStaticAnalysis: boolean;
    maxExecutionTime?: number;
}

/**
 * Validate a single patch candidate
 */
export async function validatePatch(
    config: AppConfig,
    patch: PatchCandidate,
    sandbox: SandboxEnvironment,
    testCommand: string,
    criteria: ValidationCriteria = {
        requireTestsPass: true,
        requireSyntaxValid: true,
        requireStaticAnalysis: false
    }
): Promise<ValidationResult> {

    const startTime = Date.now();

    const result: ValidationResult = {
        patchId: patch.id,
        passed: false,
        testsPassed: false,
        syntaxValid: false,
        staticAnalysisPassed: false,
        executionTime: 0,
        details: {
            testsRun: 0,
            testsFailed: 0,
            lintErrors: 0,
            typeErrors: 0
        }
    };

    try {
        // Step 1: Syntax validation
        const syntaxCheck = await validateSyntax(patch.code, sandbox);
        result.syntaxValid = syntaxCheck.valid;

        if (!syntaxCheck.valid && criteria.requireSyntaxValid) {
            result.errorMessage = `Syntax error: ${syntaxCheck.error}`;
            result.executionTime = Date.now() - startTime;
            return result;
        }

        // Step 2: Static analysis (optional)
        if (criteria.requireStaticAnalysis) {
            const staticCheck = await runStaticAnalysis(patch.code, sandbox);
            result.staticAnalysisPassed = staticCheck.passed;
            result.details.lintErrors = staticCheck.lintErrors;
            result.details.typeErrors = staticCheck.typeErrors;

            if (!staticCheck.passed) {
                result.errorMessage = `Static analysis failed: ${staticCheck.errors.join(', ')}`;
                result.executionTime = Date.now() - startTime;
                return result;
            }
        } else {
            result.staticAnalysisPassed = true;
        }

        // Step 3: Run tests
        const testResult = await runTests(testCommand, sandbox, criteria.maxExecutionTime);
        result.testsPassed = testResult.passed;
        result.details.testsRun = testResult.testsRun;
        result.details.testsFailed = testResult.testsFailed;

        if (!testResult.passed && criteria.requireTestsPass) {
            result.errorMessage = `Tests failed: ${testResult.failureMessage}`;
            result.executionTime = Date.now() - startTime;
            return result;
        }

        // All checks passed
        result.passed = true;
        result.executionTime = Date.now() - startTime;

    } catch (error: any) {
        result.errorMessage = `Validation error: ${error.message}`;
        result.executionTime = Date.now() - startTime;
    }

    return result;
}

/**
 * Validate multiple patches in parallel
 */
export async function validatePatches(
    config: AppConfig,
    patches: PatchCandidate[],
    sandbox: SandboxEnvironment,
    testCommand: string,
    criteria?: ValidationCriteria
): Promise<Map<string, ValidationResult>> {

    const results = new Map<string, ValidationResult>();

    // Validate patches sequentially to avoid sandbox conflicts
    for (const patch of patches) {
        const result = await validatePatch(config, patch, sandbox, testCommand, criteria);
        results.set(patch.id, result);

        // Early exit if we found a passing patch
        if (result.passed) {
            console.log(`[Validation] Found passing patch: ${patch.id}`);
            // Still validate remaining patches for comparison
        }
    }

    return results;
}

/**
 * Validate syntax of code
 */
async function validateSyntax(
    code: string,
    sandbox: SandboxEnvironment
): Promise<{ valid: boolean; error?: string }> {

    try {
        // Write code to temporary file
        const tempFile = `/tmp/patch_${Date.now()}.ts`;
        await sandbox.writeFile(tempFile, code);

        // Run TypeScript compiler in check mode
        const result = await sandbox.runCommand(`npx tsc --noEmit ${tempFile}`);

        // Clean up
        await sandbox.runCommand(`rm ${tempFile}`);

        if (result.exitCode === 0) {
            return { valid: true };
        } else {
            return { valid: false, error: result.stderr };
        }
    } catch (error: any) {
        return { valid: false, error: error.message };
    }
}

/**
 * Run static analysis (linting, type checking)
 */
async function runStaticAnalysis(
    code: string,
    sandbox: SandboxEnvironment
): Promise<{ passed: boolean; lintErrors: number; typeErrors: number; errors: string[] }> {

    const errors: string[] = [];
    let lintErrors = 0;
    let typeErrors = 0;

    try {
        // Run ESLint
        const tempFile = `/tmp/patch_${Date.now()}.ts`;
        await sandbox.writeFile(tempFile, code);

        const lintResult = await sandbox.runCommand(`npx eslint ${tempFile} --format json`);
        if (lintResult.exitCode !== 0) {
            try {
                const lintOutput = JSON.parse(lintResult.stdout);
                lintErrors = lintOutput[0]?.errorCount || 0;
                if (lintErrors > 0) {
                    errors.push(`${lintErrors} lint errors`);
                }
            } catch {
                // Ignore parse errors
            }
        }

        // Clean up
        await sandbox.runCommand(`rm ${tempFile}`);

    } catch (error: any) {
        errors.push(error.message);
    }

    return {
        passed: errors.length === 0,
        lintErrors,
        typeErrors,
        errors
    };
}

/**
 * Run tests
 */
async function runTests(
    testCommand: string,
    sandbox: SandboxEnvironment,
    maxExecutionTime?: number
): Promise<{ passed: boolean; testsRun: number; testsFailed: number; failureMessage?: string }> {

    try {
        const result = await sandbox.runCommand(testCommand, { timeout: maxExecutionTime });

        // Parse test output to extract counts
        const testsRun = extractTestCount(result.stdout, 'run');
        const testsFailed = extractTestCount(result.stdout, 'failed');

        return {
            passed: result.exitCode === 0,
            testsRun,
            testsFailed,
            failureMessage: result.exitCode !== 0 ? result.stderr.substring(0, 200) : undefined
        };
    } catch (error: any) {
        return {
            passed: false,
            testsRun: 0,
            testsFailed: 0,
            failureMessage: error.message
        };
    }
}

/**
 * Extract test count from test output
 */
function extractTestCount(output: string, type: 'run' | 'failed'): number {
    const patterns = {
        run: /(\d+)\s+tests?\s+(?:run|passed)/i,
        failed: /(\d+)\s+(?:tests?\s+)?failed/i
    };

    const match = output.match(patterns[type]);
    return match ? parseInt(match[1]) : 0;
}
