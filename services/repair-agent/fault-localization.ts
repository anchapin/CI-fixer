/**
 * Fault Localization Module
 * Implements LLM-based fault localization from stack traces and error logs
 * Based on RepairAgent paper (arXiv:2403.17134)
 */

import { AppConfig } from '../../types.js';
import { unifiedGenerate, safeJsonParse } from '../llm/LLMService.js';

export interface StackFrame {
    file: string;
    line: number;
    column?: number;
    function?: string;
    code?: string;
}

export interface FaultLocation {
    file: string;
    line: number;
    confidence: number;
    reasoning: string;
    suggestedFix?: string;
}

export interface FaultLocalizationResult {
    primaryLocation: FaultLocation;
    alternativeLocations: FaultLocation[];
    stackTrace: StackFrame[];
    method: 'llm' | 'spectrum' | 'hybrid';
}

/**
 * Parse stack trace from error log
 */
export function parseStackTrace(errorLog: string): StackFrame[] {
    const frames: StackFrame[] = [];

    // Node.js/TypeScript: at functionName (file:line:column)
    const nodePattern = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/g;
    let match;
    while ((match = nodePattern.exec(errorLog)) !== null) {
        if (match[2] && match[3]) {
            frames.push({
                file: match[2],
                line: parseInt(match[3]),
                column: match[4] ? parseInt(match[4]) : undefined,
                function: match[1] || undefined
            });
        }
    }

    // Python: File "file", line X, in function
    const pythonPattern = /File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?/g;
    while ((match = pythonPattern.exec(errorLog)) !== null) {
        if (match[1] && match[2]) {
            frames.push({
                file: match[1],
                line: parseInt(match[2]),
                function: match[3] || undefined
            });
        }
    }

    // Java: at package.Class.method(File.java:line)
    const javaPattern = /at\s+(.+?)\((.+?):(\d+)\)/g;
    while ((match = javaPattern.exec(errorLog)) !== null) {
        if (match[2] && match[3]) {
            frames.push({
                file: match[2],
                line: parseInt(match[3]),
                function: match[1] || undefined
            });
        }
    }

    return frames;
}

/**
 * LLM-based fault localization
 * Uses the LLM to analyze error logs and stack traces to identify the root cause location
 */
export async function localizeFault(
    config: AppConfig,
    errorLog: string,
    stackTrace: StackFrame[],
    repoContext?: string
): Promise<FaultLocalizationResult> {

    const stackTraceText = stackTrace.map((frame, i) =>
        `${i + 1}. ${frame.file}:${frame.line}${frame.function ? ` in ${frame.function}` : ''}`
    ).join('\n');

    const prompt = `You are an expert at fault localization for program repair. Analyze the error log and stack trace to identify the exact location of the bug.

## Error Log
\`\`\`
${errorLog.substring(0, 1000)}
\`\`\`

## Stack Trace
${stackTraceText}

${repoContext ? `## Repository Context\n${repoContext}\n` : ''}

## Task
Identify the PRIMARY location where the bug should be fixed. Consider:
1. Which stack frame is most likely the root cause (not just where the error surfaced)?
2. What is the confidence level (0.0-1.0)?
3. What type of fix is needed?

Respond in JSON format:
\`\`\`json
{
  "primaryLocation": {
    "file": "path/to/file.ts",
    "line": 42,
    "confidence": 0.9,
    "reasoning": "Why this is the root cause",
    "suggestedFix": "Brief description of the fix needed"
  },
  "alternativeLocations": [
    {
      "file": "path/to/other.ts",
      "line": 15,
      "confidence": 0.3,
      "reasoning": "Alternative possibility",
      "suggestedFix": "Alternative fix"
    }
  ]
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
        primaryLocation: {
            file: stackTrace[0]?.file || '',
            line: stackTrace[0]?.line || 0,
            confidence: 0.5,
            reasoning: 'Failed to parse LLM response',
            suggestedFix: 'Unknown'
        },
        alternativeLocations: []
    });

    return {
        primaryLocation: result.primaryLocation,
        alternativeLocations: result.alternativeLocations || [],
        stackTrace,
        method: 'llm'
    };
}

/**
 * Extract relevant code context around a fault location
 */
export async function getCodeContext(
    file: string,
    line: number,
    contextLines: number = 5
): Promise<string> {
    // This would integrate with the sandbox to read file content
    // For now, return a placeholder
    return `Code context for ${file}:${line} (±${contextLines} lines)`;
}

/**
 * Rank fault locations by confidence
 */
export function rankLocations(locations: FaultLocation[]): FaultLocation[] {
    return locations.sort((a, b) => b.confidence - a.confidence);
}
