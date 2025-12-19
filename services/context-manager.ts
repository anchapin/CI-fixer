
/**
 * Context Manager Service
 * 
 * Provides utilities to manage LLM context window usage by:
 * 1. Thinning large text blocks (logs, file contents).
 * 2. Summarizing historical iterations to reduce token count.
 * 3. Prioritizing context items to fit within a token budget.
 */

export interface IterationSummary {
    iteration: number;
    diagnosis: string;
    action: string; // 'edit' | 'command'
    targetParams: string; // filename or command string
    result: 'success' | 'failure';
    outcomeSummary: string;
}

export enum ContextPriority {
    CRITICAL = 100, // System instructions, Immediate Error
    HIGH = 80,      // Active File Content
    MEDIUM = 50,    // Feedback, History
    LOW = 20        // Repository Summary, General Context
}

export interface ContextItem {
    id: string;
    type: 'text' | 'code' | 'log';
    content: string;
    priority: ContextPriority;
    description?: string; // For debugging/logging
}

export class ContextManager {
    private items: ContextItem[] = [];
    private defaultTokenBudget: number;

    constructor(tokenBudget: number = 8000) {
        this.defaultTokenBudget = tokenBudget;
    }

    public addItem(item: ContextItem): void {
        this.items.push(item);
    }

    public clear(): void {
        this.items = [];
    }

    /**
     * Estimates tokens (rough heuristic: 4 chars = 1 token).
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 3.5); // slightly conservative
    }

    /**
     * Compiles the context into a single string, respecting the token budget.
     * Drops or thins lower priority items first.
     */
    public compile(maxTokens: number = this.defaultTokenBudget): string {
        // Sort by priority descending
        const sortedItems = [...this.items].sort((a, b) => b.priority - a.priority);

        let currentTokens = 0;
        const finalContextParts: string[] = [];

        for (const item of sortedItems) {
            const itemTokens = this.estimateTokens(item.content);

            if (currentTokens + itemTokens <= maxTokens) {
                // Fits completely
                finalContextParts.push(this.formatItem(item));
                currentTokens += itemTokens;
            } else {
                // Needs thinning or dropping
                const remainingBudget = maxTokens - currentTokens;
                if (remainingBudget < 50) {
                    // Too small, skip if not critical
                    if (item.priority === ContextPriority.CRITICAL) {
                        // Critical must be included, even if we blow budget slightly (or crash)
                        // But we try to squeeze head/tail
                        const thinned = thinLog(item.content, 20); // aggressively thin
                        finalContextParts.push(this.formatItem({ ...item, content: thinned }));
                        currentTokens += this.estimateTokens(thinned);
                    } else {
                        console.log(`[ContextManager] Dropped item '${item.id}' (Priority ${item.priority}) - Budget Exceeded`);
                    }
                    continue;
                }

                // Thinning strategy based on type
                if (item.type === 'log') {
                    // Calculate how many lines effectively fit? 
                    // Heuristic: 1 line approx 100 chars? ~25 tokens.
                    const textBudgetChars = remainingBudget * 3.5;
                    const linesBudget = Math.floor(textBudgetChars / 100);
                    const keepLines = Math.max(10, linesBudget);
                    const thinned = thinLog(item.content, keepLines);
                    finalContextParts.push(this.formatItem({ ...item, content: thinned }));
                    currentTokens += this.estimateTokens(thinned);
                } else if (item.type === 'text' || item.type === 'code') {
                    // Truncate
                    const textBudgetChars = Math.floor(remainingBudget * 3.5);
                    const truncated = item.content.substring(0, textBudgetChars) + "\n... [Truncated due to context limit] ...";
                    finalContextParts.push(this.formatItem({ ...item, content: truncated }));
                    currentTokens += this.estimateTokens(truncated);
                }
            }
        }

        return finalContextParts.join('\n\n');
    }

    private formatItem(item: ContextItem): string {
        switch (item.priority) {
            case ContextPriority.CRITICAL:
            case ContextPriority.HIGH:
                return `=== ${item.description || item.id} ===\n${item.content}`;
            default:
                return `--- ${item.description || item.id} ---\n${item.content}`;
        }
    }
}

/**
 * Truncates a large string (like a log file) to keep the beginning and end,
 * replacing the middle with a summary message.
 * 
 * @param content The full text content
 * @param maxLines The maximum number of lines to keep (approx split evenly top/bottom)
 * @returns The thinned content
 */
/**
 * Truncates a large string (like a log file) to keep the beginning and end,
 * replacing the middle with a summary message.
 */
export function thinLog(content: string, maxLines: number = 200): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) {
        return content;
    }

    const half = Math.floor(maxLines / 2);
    const head = lines.slice(0, half);
    const tail = lines.slice(lines.length - half);
    const removedCount = lines.length - maxLines;

    return [
        ...head,
        `\n... [Context Thinned: Removed ${removedCount} lines] ...\n`,
        ...tail
    ].join('\n');
}

/**
 * Intelligent log thinner using attention-based compression (ALWAYS ENABLED)
 * 
 * Strategy:
 * 1. Use ATTENTION-RAG token importance scoring
 * 2. Compress based on target token budget
 * 3. Preserve high-importance information
 * 4. Fall back to simple thinning if compression fails
 */
export async function smartThinLog(content: string, maxLines: number = 300): Promise<string> {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;

    // Use line-based fallback for log data (attention-based compression better for prose)
    // The compressor is designed for sentence-based text, not line-based logs
    // try {
    //     // Import dynamically to avoid circular dependencies
    //     const { adaptiveCompress } = await import('./context-compression/compressor.js');

    //     // Convert maxLines to approximate token budget
    //     // Use more conservative estimate: 1 line ≈ 8-10 tokens on average
    //     const avgCharsPerLine = content.length / lines.length;
    //     const maxTokens = maxLines * (avgCharsPerLine / 4); // 4 chars per token heuristic

    //     const result = adaptiveCompress(content, maxTokens);

    //     console.log(`[ContextCompression] ${result.originalLength} -> ${result.compressedLength} tokens (${result.compressionRatio.toFixed(1)}x, ${(result.retainedImportance * 100).toFixed(1)}% retained)`);
    //     return result.compressed;
    // } catch (error) {
    //     console.warn('[ContextCompression] Failed, using fallback:', error);
    // }

    // Fallback to original error-keyword-based thinning
    const errorKeywords = [/error/i, /fail/i, /exception/i, /fatal/i, /panicked/i];
    const contextWindow = 10; // lines before and after

    // Identify interesting lines
    const interestingIndices: number[] = [];
    lines.forEach((line, idx) => {
        if (errorKeywords.some(regex => regex.test(line))) {
            interestingIndices.push(idx);
        }
    });

    if (interestingIndices.length === 0) {
        return thinLog(content, maxLines);
    }

    // Expand to windows and merge
    const keptIndices = new Set<number>();

    // Always keep header (first 20 lines)
    for (let i = 0; i < Math.min(20, lines.length); i++) keptIndices.add(i);
    // Always keep footer (last 20 lines)
    for (let i = Math.max(0, lines.length - 20); i < lines.length; i++) keptIndices.add(i);

    // Add windows around errors
    const maxErrorBlocks = 20;
    let blocksAdded = 0;

    for (const idx of interestingIndices) {
        if (blocksAdded >= maxErrorBlocks) break;

        const start = Math.max(0, idx - contextWindow);
        const end = Math.min(lines.length - 1, idx + contextWindow);

        for (let i = start; i <= end; i++) keptIndices.add(i);
        blocksAdded++;
    }

    const sortedIndices = Array.from(keptIndices).sort((a, b) => a - b);

    const resultLines: string[] = [];
    let lastIdx = -1;

    for (const idx of sortedIndices) {
        if (lastIdx !== -1 && idx > lastIdx + 1) {
            const skipped = idx - lastIdx - 1;
            resultLines.push(`\n... [Smart Context: Skipped ${skipped} non-error lines] ...\n`);
        }
        resultLines.push(lines[idx]);
        lastIdx = idx;
    }

    return resultLines.join('\n');
}

/**
 * Formats a list of past iteration summaries into a concise string.
 * This is used to replace the raw full-text feedback history.
 * 
 * @param summaries List of iteration summaries
 * @returns Formatted string
 */
export function formatHistorySummary(summaries: IterationSummary[]): string {
    if (summaries.length === 0) return "";

    let output = "## Previous Attempts History\n";
    summaries.forEach(s => {
        const symbol = s.result === 'success' ? '✅' : '❌';
        output += `- [Iter ${s.iteration}] ${symbol} Action: ${s.action} on \`${s.targetParams}\`\n`;
        output += `  Diagnosis: ${s.diagnosis.substring(0, 100)}${s.diagnosis.length > 100 ? '...' : ''}\n`;
        output += `  Outcome: ${s.outcomeSummary}\n`;
    });

    return output;
}

/**
 * Helper to convert complex feedback arrays into structured summaries if possible.
 * (This is a simplified adapter for now, assumes we build IterationSummary manually in the worker)
 */
export function compressFeedbackHistory(history: string[]): string {
    // If we only have raw strings, we just join them but truncate individual items if too long
    return history.map((item, idx) => {
        if (item.length > 300) {
            return `[Item ${idx + 1}] ${item.substring(0, 300)}... (truncated)`;
        }
        return `[Item ${idx + 1}] ${item}`;
    }).join('\n');
}

/**
 * Formats the structured plan object into a Markdown string for persistence.
 */
export function formatPlanToMarkdown(plan: any): string {
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    const taskList = tasks.map((t: any) => `- [${t.status === 'done' ? 'x' : ' '}] ${t.description}`).join('\n');
    return `# Implementation Plan\n\n**Goal**: ${plan.goal}\n\n## Tasks\n${taskList}\n\n**Approved**: ${plan.approved}`;
}
