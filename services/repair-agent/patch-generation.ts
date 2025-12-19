/**
 * Patch Generation Module
 * Implements multi-candidate patch generation with diversity strategies
 * Based on RepairAgent paper (arXiv:2403.17134)
 */

import { AppConfig } from '../../types.js';
import { unifiedGenerate, safeJsonParse } from '../llm/LLMService.js';
import { FaultLocation } from './fault-localization.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PatchCandidate {
    id: string;
    code: string;
    description: string;
    confidence: number;
    strategy: 'direct' | 'conservative' | 'aggressive' | 'alternative';
    reasoning: string;
    spellingErrors?: string[];
}

export interface PatchGenerationResult {
    candidates: PatchCandidate[];
    primaryCandidate: PatchCandidate;
    context: {
        faultLocation: FaultLocation;
        originalCode: string;
        errorMessage: string;
    };
}

/**
 * Generate multiple patch candidates using different strategies
 */
export async function generatePatchCandidates(
    config: AppConfig,
    faultLocation: FaultLocation,
    originalCode: string,
    errorMessage: string,
    repoContext?: string
): Promise<PatchGenerationResult> {

    const candidates: PatchCandidate[] = [];

    // Strategy 1: Direct fix (high confidence, minimal change)
    const directPatch = await generateDirectPatch(
        config,
        faultLocation,
        originalCode,
        errorMessage,
        repoContext
    );
    candidates.push(directPatch);

    // Strategy 2: Conservative fix (safe, defensive programming)
    const conservativePatch = await generateConservativePatch(
        config,
        faultLocation,
        originalCode,
        errorMessage,
        repoContext
    );
    candidates.push(conservativePatch);

    // Strategy 3: Alternative approach (different solution)
    const alternativePatch = await generateAlternativePatch(
        config,
        faultLocation,
        originalCode,
        errorMessage,
        repoContext
    );
    candidates.push(alternativePatch);

    // Rank candidates by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);

    return {
        candidates,
        primaryCandidate: candidates[0],
        context: {
            faultLocation,
            originalCode,
            errorMessage
        }
    };
}

/**
 * Strategy 1: Direct fix - minimal change to fix the immediate issue
 */
async function generateDirectPatch(
    config: AppConfig,
    faultLocation: FaultLocation,
    originalCode: string,
    errorMessage: string,
    repoContext?: string
): Promise<PatchCandidate> {

    const prompt = `You are an expert at program repair. Generate a MINIMAL fix for this bug.

## Error
${errorMessage}

## Fault Location
File: ${faultLocation.file}
Line: ${faultLocation.line}
Reasoning: ${faultLocation.reasoning}

## Current Code
\`\`\`
${originalCode}
\`\`\`

${repoContext ? `## Repository Context\n${repoContext}\n` : ''}

## Instructions
Generate a MINIMAL, DIRECT fix that:
1. Fixes the immediate error
2. Makes the smallest possible change
3. Preserves all existing functionality
4. Uses the same coding style
5. **IMPORTANT**: If generating a Dockerfile, DO NOT include inline comments (starting with #) inside multi-line RUN instructions (after \\). This breaks the build.

Respond in JSON format:
\`\`\`json
{
  "code": "// Complete fixed code here",
  "description": "Brief description of the fix",
  "confidence": 0.9,
  "reasoning": "Why this fix works"
}
\`\`\`

Respond with ONLY the JSON object.`;

    const response = await unifiedGenerate(config, {
        contents: prompt,
        config: { temperature: 0.1, maxOutputTokens: 2048 },
        model: 'gemini-2.5-flash',
        responseFormat: 'json'
    });

    const result = safeJsonParse(response.text, {
        code: originalCode,
        description: 'Failed to generate patch',
        confidence: 0.0,
        reasoning: 'Parse error'
    });

    // Post-process patch for common errors
    result.code = postProcessPatch(faultLocation.file, result.code);

    // Spelling check
    const spellingErrors = checkSpelling(faultLocation.file, result.code);
    const confidenceAdjustment = calculateSpellingPenalty(spellingErrors.length);

    return {
        id: 'direct-' + Date.now(),
        code: result.code,
        description: result.description,
        confidence: Math.max(0, result.confidence - confidenceAdjustment),
        strategy: 'direct',
        reasoning: result.reasoning,
        spellingErrors: spellingErrors.length > 0 ? spellingErrors : undefined
    };
}

/**
 * Strategy 2: Conservative fix - defensive programming with error handling
 */
async function generateConservativePatch(
    config: AppConfig,
    faultLocation: FaultLocation,
    originalCode: string,
    errorMessage: string,
    repoContext?: string
): Promise<PatchCandidate> {

    const prompt = `You are an expert at program repair. Generate a CONSERVATIVE fix with defensive programming.

## Error
${errorMessage}

## Fault Location
File: ${faultLocation.file}
Line: ${faultLocation.line}

## Current Code
\`\`\`
${originalCode}
\`\`\`

## Instructions
Generate a CONSERVATIVE fix that:
1. Adds proper error handling
2. Includes null/undefined checks
3. Adds validation where needed
4. Is safe and defensive
5. **IMPORTANT**: If generating a Dockerfile, DO NOT include inline comments (starting with #) inside multi-line RUN instructions (after \\). This breaks the build.

Respond in JSON format:
\`\`\`json
{
  "code": "// Complete fixed code with error handling",
  "description": "Conservative fix with error handling",
  "confidence": 0.85,
  "reasoning": "Why this defensive approach is safer"
}
\`\`\`

Respond with ONLY the JSON object.`;

    const response = await unifiedGenerate(config, {
        contents: prompt,
        config: { temperature: 0.2, maxOutputTokens: 2048 },
        model: 'gemini-2.5-flash',
        responseFormat: 'json'
    });

    const result = safeJsonParse(response.text, {
        code: originalCode,
        description: 'Failed to generate conservative patch',
        confidence: 0.0,
        reasoning: 'Parse error'
    });

    // Post-process patch for common errors
    result.code = postProcessPatch(faultLocation.file, result.code);

    // Spelling check
    const spellingErrors = checkSpelling(faultLocation.file, result.code);
    const confidenceAdjustment = calculateSpellingPenalty(spellingErrors.length);

    return {
        id: 'conservative-' + Date.now(),
        code: result.code,
        description: result.description,
        confidence: Math.max(0, (result.confidence * 0.9) - confidenceAdjustment), // Slightly lower confidence for more complex changes
        strategy: 'conservative',
        reasoning: result.reasoning,
        spellingErrors: spellingErrors.length > 0 ? spellingErrors : undefined
    };
}

/**
 * Strategy 3: Alternative approach - different solution to the same problem
 */
async function generateAlternativePatch(
    config: AppConfig,
    faultLocation: FaultLocation,
    originalCode: string,
    errorMessage: string,
    repoContext?: string
): Promise<PatchCandidate> {

    const prompt = `You are an expert at program repair. Generate an ALTERNATIVE solution to this bug.

## Error
${errorMessage}

## Fault Location
File: ${faultLocation.file}
Line: ${faultLocation.line}

## Current Code
\`\`\`
${originalCode}
\`\`\`

## Instructions
Generate an ALTERNATIVE fix that:
1. Solves the problem differently
2. May refactor the approach
3. Could be more elegant or efficient
4. Still preserves functionality
5. **IMPORTANT**: If generating a Dockerfile, DO NOT include inline comments (starting with #) inside multi-line RUN instructions (after \\). This breaks the build.

Respond in JSON format:
\`\`\`json
{
  "code": "// Complete alternative solution",
  "description": "Alternative approach to fixing the issue",
  "confidence": 0.75,
  "reasoning": "Why this alternative is worth considering"
}
\`\`\`

Respond with ONLY the JSON object.`;

    const response = await unifiedGenerate(config, {
        contents: prompt,
        config: { temperature: 0.3, maxOutputTokens: 2048 },
        model: 'gemini-2.5-flash',
        responseFormat: 'json'
    });

    const result = safeJsonParse(response.text, {
        code: originalCode,
        description: 'Failed to generate alternative patch',
        confidence: 0.0,
        reasoning: 'Parse error'
    });

    // Post-process patch for common errors
    result.code = postProcessPatch(faultLocation.file, result.code);

    // Spelling check
    const spellingErrors = checkSpelling(faultLocation.file, result.code);
    const confidenceAdjustment = calculateSpellingPenalty(spellingErrors.length);

    return {
        id: 'alternative-' + Date.now(),
        code: result.code,
        description: result.description,
        confidence: Math.max(0, (result.confidence * 0.85) - confidenceAdjustment), // Lower confidence for alternative approaches
        strategy: 'alternative',
        reasoning: result.reasoning,
        spellingErrors: spellingErrors.length > 0 ? spellingErrors : undefined
    };
}

/**
 * Helper to identify Dockerfiles
 */
function isDockerfile(filename: string): boolean {
    const f = filename.toLowerCase();
    return f === 'dockerfile' || f.endsWith('.dockerfile') || f.includes('dockerfile.');
}

/**
 * Master post-processor for all generated patches
 */
function postProcessPatch(filename: string, code: string): string {
    let processed = code;

    // 1. Fix common flag typos (Applied to all files as they might contain shell commands)
    processed = cleanShellFlags(processed);

    // 2. Dockerfile-specific cleaning
    if (isDockerfile(filename)) {
        processed = stripDockerfileInlineComments(processed);
    }

    return processed;
}

/**

 * Checks spelling in the generated code using cspell

 */

function checkSpelling(filename: string, code: string): string[] {

    const ext = path.extname(filename) || '.txt';

    const tempFile = path.resolve(process.cwd(), `temp-spell-check-${Date.now()}${ext}`);

    

    try {

        fs.writeFileSync(tempFile, code);

        

        // Try local cspell first, then npx

        const isWin = process.platform === 'win32';

        const cspellName = isWin ? 'cspell.cmd' : 'cspell';

        const localCspell = path.resolve(process.cwd(), 'node_modules', '.bin', cspellName);

        

        let cmd = "";

        if (fs.existsSync(localCspell)) {

            cmd = `"${localCspell}" "${tempFile}" --no-summary --no-progress`;

        } else {

            cmd = `npx cspell "${tempFile}" --no-summary --no-progress`;

        }

        

        try {

            execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

            return []; // No errors

        } catch (e: any) {

            const output = (e.stdout || "") + "\n" + (e.stderr || "");

            const lines = output.split('\n');

            

            const errors = lines

                .map((l: string) => {

                    const match = l.match(/Unknown word \((.*?)\)/);

                    return match ? match[1] : null;

                })

                .filter((w: string | null): w is string => !!w);

            

            return [...new Set(errors)];

        }

    } catch (e) {

        console.error('[checkSpelling] Error:', e);

        return [];

    } finally {

        if (fs.existsSync(tempFile)) {

            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }

        }

    }

}



/**
 * Calculates a confidence penalty based on the number of spelling errors
 */
function calculateSpellingPenalty(errorCount: number): number {
    const THRESHOLD = 3; // Maximum acceptable spelling errors before penalty increases
    if (errorCount === 0) return 0;
    if (errorCount <= THRESHOLD) return 0.05; // Minor penalty for few errors
    return 0.1 + (errorCount - THRESHOLD) * 0.02; // Steeper penalty for more errors
}

/**
 * Registry of common shell flag typos and their corrections
 */
const SHELL_FLAG_CORRECTIONS = [
    {
        // apt-get --no-install-recommends
        // Handles: --no-installrecommends, --no-install-recommend, --no-installfrrecommends, etc.
        pattern: /--no-install[- ]*(?:fr)?recom+ends?\b/gi,
        replacement: '--no-install-recommends'
    },
    {
        // pip --no-cache-dir
        // Handles: --no-cache, --no-cachedir, --nocache-dir
        pattern: /--no-?cache(?:-?dir)?\b/gi,
        replacement: '--no-cache-dir'
    },
    {
        // npm --no-audit
        pattern: /--noaudit\b/gi,
        replacement: '--no-audit'
    }
];

/**
 * Fixes common typos in shell command flags using a generic pattern registry
 */
function cleanShellFlags(code: string): string {
    let processed = code;

    for (const { pattern, replacement } of SHELL_FLAG_CORRECTIONS) {
        processed = processed.replace(pattern, replacement);
    }

    return processed;
}

/**
 * Removes inline comments in multi-line RUN commands which break Docker builds
 */
function stripDockerfileInlineComments(code: string): string {
    const lines = code.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('#')) {
            const prevLine = i > 0 ? lines[i - 1].trim() : "";
            if (prevLine.endsWith('\\')) {
                // Inline comment inside multi-line command - skip it
                continue;
            }
        }
        resultLines.push(line);
    }

    return resultLines.join('\n');
}

/**
 * Rank patches by multiple criteria
 */
export function rankPatches(candidates: PatchCandidate[]): PatchCandidate[] {
    return candidates.sort((a, b) => {
        // Primary: confidence
        if (Math.abs(a.confidence - b.confidence) > 0.1) {
            return b.confidence - a.confidence;
        }

        // Secondary: prefer direct fixes
        const strategyScore = { direct: 3, conservative: 2, alternative: 1, aggressive: 0 };
        return (strategyScore[b.strategy] || 0) - (strategyScore[a.strategy] || 0);
    });
}

/**
 * Filter patches by minimum confidence threshold
 */
export function filterByConfidence(
    candidates: PatchCandidate[],
    minConfidence: number = 0.5
): PatchCandidate[] {
    return candidates.filter(c => c.confidence >= minConfidence);
}
