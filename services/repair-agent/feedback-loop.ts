/**
 * Feedback Loop Integration
 * Implements iterative refinement based on validation results
 */

import { AppConfig } from '../../types.js';
import { PatchCandidate } from './patch-generation.js';
import { ValidationResult } from './patch-validation.js';
import { unifiedGenerate, safeJsonParse } from '../llm/LLMService.js';

export interface FeedbackEntry {
    patchId: string;
    validationResult: ValidationResult;
    timestamp: number;
    learnings: string[];
}

export interface RefinementResult {
    refinedPatch: PatchCandidate;
    feedbackApplied: string[];
    iterationCount: number;
}

/**
 * Refine a patch based on validation feedback
 */
export async function refinePatchWithFeedback(
    config: AppConfig,
    originalPatch: PatchCandidate,
    validationResult: ValidationResult,
    previousFeedback: FeedbackEntry[] = []
): Promise<RefinementResult> {

    // Extract learnings from validation failure
    const learnings = extractLearnings(validationResult);

    // Build feedback context
    const feedbackContext = buildFeedbackContext(previousFeedback, learnings);

    // Generate refined patch
    const refinedPatch = await generateRefinedPatch(
        config,
        originalPatch,
        validationResult,
        feedbackContext
    );

    return {
        refinedPatch,
        feedbackApplied: learnings,
        iterationCount: previousFeedback.length + 1
    };
}

/**
 * Extract learnings from validation failure
 */
function extractLearnings(validationResult: ValidationResult): string[] {
    const learnings: string[] = [];

    if (!validationResult.syntaxValid) {
        learnings.push('Syntax error detected - ensure code is syntactically correct');
    }

    if (!validationResult.testsPassed) {
        learnings.push(`${validationResult.details.testsFailed} tests failed - fix must pass all tests`);
    }

    if (!validationResult.staticAnalysisPassed) {
        if (validationResult.details.lintErrors > 0) {
            learnings.push(`${validationResult.details.lintErrors} lint errors - follow code style guidelines`);
        }
        if (validationResult.details.typeErrors > 0) {
            learnings.push(`${validationResult.details.typeErrors} type errors - ensure type safety`);
        }
    }

    if (validationResult.errorMessage) {
        learnings.push(`Error: ${validationResult.errorMessage}`);
    }

    return learnings;
}

/**
 * Build feedback context from previous attempts
 */
function buildFeedbackContext(
    previousFeedback: FeedbackEntry[],
    currentLearnings: string[]
): string {

    if (previousFeedback.length === 0 && currentLearnings.length === 0) {
        return '';
    }

    let context = '## Previous Attempts and Learnings\n\n';

    // Add previous feedback
    previousFeedback.forEach((entry, index) => {
        context += `### Attempt ${index + 1}\n`;
        context += `- Patch ID: ${entry.patchId}\n`;
        context += `- Validation: ${entry.validationResult.passed ? 'PASSED' : 'FAILED'}\n`;
        if (entry.learnings.length > 0) {
            context += `- Learnings:\n`;
            entry.learnings.forEach(learning => {
                context += `  - ${learning}\n`;
            });
        }
        context += '\n';
    });

    // Add current learnings
    if (currentLearnings.length > 0) {
        context += `### Current Feedback\n`;
        currentLearnings.forEach(learning => {
            context += `- ${learning}\n`;
        });
    }

    return context;
}

/**
 * Generate refined patch incorporating feedback
 */
async function generateRefinedPatch(
    config: AppConfig,
    originalPatch: PatchCandidate,
    validationResult: ValidationResult,
    feedbackContext: string
): Promise<PatchCandidate> {

    const prompt = `You are an expert at program repair. Refine this patch based on validation feedback.

## Original Patch
\`\`\`
${originalPatch.code}
\`\`\`

## Validation Result
- Tests Passed: ${validationResult.testsPassed ? 'YES' : 'NO'}
- Syntax Valid: ${validationResult.syntaxValid ? 'YES' : 'NO'}
- Static Analysis: ${validationResult.staticAnalysisPassed ? 'YES' : 'NO'}
${validationResult.errorMessage ? `- Error: ${validationResult.errorMessage}` : ''}

${feedbackContext}

## Instructions
Generate a REFINED patch that:
1. Addresses all validation failures
2. Incorporates learnings from previous attempts
3. Maintains the original fix intent
4. Passes all checks

Respond in JSON format:
\`\`\`json
{
  "code": "// Complete refined code here",
  "description": "What was changed to address feedback",
  "confidence": 0.85,
  "reasoning": "Why this refinement should work"
}
\`\`\`

Respond with ONLY the JSON object.`;

    const response = await unifiedGenerate(config, {
        contents: prompt,
        config: { temperature: 0.15, maxOutputTokens: 2048 },
        model: 'gemini-2.5-flash',
        responseFormat: 'json'
    });

    const result = safeJsonParse(response.text, {
        code: originalPatch.code,
        description: 'Failed to refine patch',
        confidence: originalPatch.confidence * 0.9,
        reasoning: 'Parse error'
    });

    return {
        id: `refined-${originalPatch.id}-${Date.now()}`,
        code: result.code,
        description: result.description,
        confidence: result.confidence,
        strategy: originalPatch.strategy,
        reasoning: result.reasoning
    };
}

/**
 * Iterative refinement loop
 */
export async function iterativeRefinement(
    config: AppConfig,
    initialPatch: PatchCandidate,
    validateFn: (patch: PatchCandidate) => Promise<ValidationResult>,
    maxIterations: number = 3
): Promise<{ finalPatch: PatchCandidate; validationResult: ValidationResult; iterations: number }> {

    let currentPatch = initialPatch;
    const feedbackHistory: FeedbackEntry[] = [];
    let validationResult: ValidationResult;

    for (let i = 0; i < maxIterations; i++) {
        // Validate current patch
        validationResult = await validateFn(currentPatch);

        // If passed, we're done
        if (validationResult.passed) {
            return {
                finalPatch: currentPatch,
                validationResult,
                iterations: i + 1
            };
        }

        // Extract learnings and add to history
        const learnings = extractLearnings(validationResult);
        feedbackHistory.push({
            patchId: currentPatch.id,
            validationResult,
            timestamp: Date.now(),
            learnings
        });

        // Refine patch for next iteration
        if (i < maxIterations - 1) {
            const refinement = await refinePatchWithFeedback(
                config,
                currentPatch,
                validationResult,
                feedbackHistory
            );
            currentPatch = refinement.refinedPatch;
        }
    }

    // Max iterations reached without success
    return {
        finalPatch: currentPatch,
        validationResult: validationResult!,
        iterations: maxIterations
    };
}
