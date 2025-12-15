/**
 * Structured prompt generation utilities for improved LLM responses
 * Based on research: "Aligning LLM Objectives for Program Repair" (January 2025)
 */

export interface FixPromptContext {
    filePath: string;
    errorMessage: string;
    errorCategory: string;
    errorLine?: number;
    rootCause: string;
    fileContent: string;
    language: string;
    examplePattern: string;
}

export interface DiagnosisPromptContext {
    errorLog: string;
    repoContext?: string;
    feedbackHistory?: string[];
}

/**
 * Generate structured prompt for code fix generation
 * Ensures complete, valid code without truncation
 */
export function generateFixPrompt(context: FixPromptContext): string {
    const locationInfo = context.errorLine
        ? `- **Location**: Line ${context.errorLine}`
        : '';

    return `You are an expert software engineer fixing a ${context.errorCategory} error.

## Task
Fix the error in \`${context.filePath}\` by generating complete, valid code.

## Error Analysis
- **Type**: ${context.errorCategory}
- **Message**: ${context.errorMessage}
${locationInfo}
- **Root Cause**: ${context.rootCause}

## Current Code
\`\`\`${context.language}
${context.fileContent}
\`\`\`

## Requirements
1. Generate COMPLETE code (no truncation, no placeholders like "..." or "// rest of code")
2. Preserve all existing functionality
3. Follow the existing code style and conventions
4. Include all necessary imports
5. Ensure syntax validity

## Output Format
Respond with ONLY the fixed code in a markdown code block:
\`\`\`${context.language}
// Your complete fixed code here
\`\`\`

## Example Fix Pattern
For ${context.errorCategory} errors, typical fixes involve:
${context.examplePattern}

Now provide the complete fixed code:`;
}

/**
 * Generate diagnosis prompt with few-shot examples
 * Improves accuracy and ensures structured JSON output
 */
export function generateDiagnosisPrompt(context: DiagnosisPromptContext): string {
    const fewShotExamples = `
## Example 1: Dependency Error
**Log**: "Error: Cannot find module 'express'"
**Diagnosis**:
\`\`\`json
{
  "summary": "Missing dependency 'express'",
  "filePath": "package.json",
  "fixAction": "command",
  "suggestedCommand": "npm install express",
  "confidence": 0.95
}
\`\`\`

## Example 2: Syntax Error
**Log**: "SyntaxError: Unexpected token '}' at server.ts:45"
**Diagnosis**:
\`\`\`json
{
  "summary": "Unmatched closing brace",
  "filePath": "server.ts",
  "fixAction": "edit",
  "confidence": 0.90
}
\`\`\`

## Example 3: Type Error
**Log**: "TypeError: Cannot read property 'name' of undefined at user.ts:23"
**Diagnosis**:
\`\`\`json
{
  "summary": "Null reference error - missing null check",
  "filePath": "user.ts",
  "fixAction": "edit",
  "confidence": 0.85
}
\`\`\``;

    const repoContextSection = context.repoContext
        ? `\n## Repository Context\n${context.repoContext}\n`
        : '';

    const feedbackSection = context.feedbackHistory?.length
        ? `\n## Previous Attempts\n${context.feedbackHistory.join('\n')}\n`
        : '';

    return `You are an expert at diagnosing CI/CD errors. Analyze the error log and provide a structured diagnosis.

${fewShotExamples}

## Your Task
Analyze this error log:
\`\`\`
${context.errorLog}
\`\`\`
${repoContextSection}${feedbackSection}
Provide diagnosis in the same JSON format. Be specific about the file path and fix action.
Respond with ONLY the JSON object, no additional text.`;
}

/**
 * Generate chain-of-thought prompt for complex fixes
 * Uses step-by-step reasoning for better results
 */
export function generateChainOfThoughtPrompt(context: FixPromptContext): string {
    return `You are an expert software engineer. Fix this complex error using step-by-step reasoning.

## Error
**Type**: ${context.errorCategory}
**Message**: ${context.errorMessage}
**File**: ${context.filePath}

## Code
\`\`\`${context.language}
${context.fileContent}
\`\`\`

## Instructions
Think through this step-by-step:

1. **Understand the Error**: What is the root cause?
2. **Identify Dependencies**: What other code is affected?
3. **Plan the Fix**: What changes are needed?
4. **Implement**: Write the complete fixed code
5. **Verify**: Check for edge cases

Respond in this JSON format:
\`\`\`json
{
  "reasoning": {
    "root_cause": "Detailed explanation of what's wrong",
    "dependencies": ["List of affected files or modules"],
    "plan": "Step-by-step plan for the fix",
    "edge_cases": ["Potential edge cases to consider"]
  },
  "fixed_code": "Complete fixed code here"
}
\`\`\`

Ensure the fixed_code is COMPLETE with no truncation.`;
}
