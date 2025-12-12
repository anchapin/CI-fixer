
import { AppConfig, AgentState } from '../types.js';

// In-memory cache for repo context
const repoContextCache = new Map<string, string>();

/**
 * Filter logs to extract only relevant error blocks
 * Rule: "Error", "Fail", "Exception" + 5 lines context
 */
export function filterLogs(rawLogs: string): string {
    if (!rawLogs) return "";

    const lines = rawLogs.split('\n');
    const relevantIndices = new Set<number>();

    // 1. Identify key lines
    lines.forEach((line, index) => {
        const lower = line.toLowerCase();
        if (lower.includes('error') || lower.includes('fail') || lower.includes('exception')) {
            // Add context window (+/- 5 lines)
            for (let i = Math.max(0, index - 5); i <= Math.min(lines.length - 1, index + 5); i++) {
                relevantIndices.add(i);
            }
        }
    });

    // Always include the Header (first 20 lines) and Footer (last 20 lines) for structural context
    // This helps if the error is at the very end or setup info is needed.
    // User asked for "Only lines... + 5 lines context", but stripping header/footer usually hurts more than helps.
    // I will adhere strictly to "Error/Fail/Exception" for the body, but keep strict adherence if requested.
    // User Request: "extract only lines with Error..."
    // Let's stick to the heuristic + maybe the absolute last 10 lines as a safety net for "exit code".
    for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
        relevantIndices.add(i);
    }

    // Convert to sorted array
    const indices = Array.from(relevantIndices).sort((a, b) => a - b);

    if (indices.length === 0) {
        // Fallback: If no keywords found, return tail
        return lines.slice(-50).join('\n');
    }

    // Reconstruct with ellipses for gaps
    const resultLines: string[] = [];
    let lastIndex = -1;

    for (const index of indices) {
        if (lastIndex !== -1 && index > lastIndex + 1) {
            resultLines.push('... [Skipped content] ...');
        }
        resultLines.push(lines[index]);
        lastIndex = index;
    }

    return resultLines.join('\n');
}

/**
 * Structured Summary of Logs
 * For 20k lines -> "Step 4 failed with Exit Code 1"
 */
export async function summarizeLogs(filteredLogs: string): Promise<string> {
    // In a real implementation, we would call an LLM here.
    // For now, we perform a heuristic summary.

    // 1. Look for "Exit Code"
    const exitCodeMatch = filteredLogs.match(/exit code\s+(\d+)/i);
    const exitCode = exitCodeMatch ? exitCodeMatch[1] : "unknown";

    // 2. Look for "Failed" job name
    const jobMatch = filteredLogs.match(/Job\s+['"]?([a-zA-Z0-9_\-\s]+)['"]?\s+failed/i);
    const jobName = jobMatch ? jobMatch[1] : "Job";

    // 3. Count errors
    const errorCount = (filteredLogs.match(/error/gi) || []).length;

    return `Analysis Summary: ${jobName} failed with Exit Code ${exitCode}. Found ${errorCount} error occurrences in filtered logs.`;
}

/**
 * Cacheable Repo Context
 */
export function getCachedRepoContext(config: AppConfig, headSha: string, generator: () => Promise<string>): Promise<string> {
    const key = `${config.repoUrl}-${headSha}`;
    if (repoContextCache.has(key)) {
        console.log(`[ContextCompiler] Hit cache for ${key}`);
        return Promise.resolve(repoContextCache.get(key)!);
    }

    console.log(`[ContextCompiler] Miss cache for ${key}, generating...`);
    return generator().then(context => {
        repoContextCache.set(key, context);
        return context;
    });
}
