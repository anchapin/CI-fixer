/**
 * Model Configuration
 *
 * Central configuration for LLM models used throughout the application.
 * This abstraction decouples application logic from specific model versions,
 * making it easy to upgrade or change models without modifying multiple files.
 */

export const MODEL_ALIASES = {
    // For complex reasoning, planning, and deep code analysis
    SMART: "gemini-3-pro-preview",

    // For high-speed tasks, classification, and summarization
    FAST: "gemini-2.5-flash",

    // Specifically for code generation (can be same as smart, or a specialized code model)
    CODING: "gemini-3-pro-preview",
} as const;

/**
 * Task types for model selection
 */
export type ModelTask = 'reasoning' | 'coding' | 'fast';

/**
 * Returns the recommended model for a specific task type.
 * This allows us to switch models for specific tasks without changing every file.
 *
 * @param task - The type of task being performed
 * @returns The model identifier to use
 */
export function getModelForTask(task: ModelTask): string {
    switch (task) {
        case 'reasoning':
            return MODEL_ALIASES.SMART;
        case 'coding':
            return MODEL_ALIASES.CODING;
        case 'fast':
            return MODEL_ALIASES.FAST;
        default:
            return MODEL_ALIASES.FAST;
    }
}
