/**
 * Extracts content from a markdown code block.
 *
 * Strategies:
 * 1. strict: Returns null if no code block is found.
 * 2. loose: Returns the original content if no code block is found (NOT used for this fix, but useful for reference).
 *
 * @param text The input text containing potential markdown code blocks.
 * @returns The content inside the first code block, or null if no code block is found.
 */
export function extractCodeBlock(text: string): string | null {
    const startMarker = '```';
    const firstIndex = text.indexOf(startMarker);

    if (firstIndex === -1) return null;

    const openingFenceEnd = firstIndex + startMarker.length;
    const closingMarkerIndex = text.indexOf(startMarker, openingFenceEnd);

    if (closingMarkerIndex === -1) return null;

    const contentWithInfo = text.substring(openingFenceEnd, closingMarkerIndex);

    // Check if there is a newline in the content before any code
    const newlineIndex = contentWithInfo.indexOf('\n');

    if (newlineIndex !== -1) {
        // Multi-line block: first line is info string (language), rest is code
        return contentWithInfo.substring(newlineIndex + 1).trim();
    } else {
        // Single-line block or no language specifier with immediate newline
        return contentWithInfo.trim();
    }
}

/**
 * Strict version of extractCodeBlock that throws an error if no code block is found.
 * This is the recommended function for file writing operations - NEVER trust raw LLM output.
 *
 * @param text The input text containing potential markdown code blocks.
 * @returns The content inside the first code block.
 * @throws {Error} If no code block is found in the text.
 */
export function extractCodeBlockStrict(text: string): string {
    const code = extractCodeBlock(text);
    if (code === null) {
        throw new Error(
            'No markdown code block found in LLM output. ' +
            'Strict code block extraction requires the LLM to return content within ```...``` markers. ' +
            'This prevents writing conversational filler or unstructured text to files.'
        );
    }
    return code;
}

/**
 * Validates if the text contains a markdown code block.
 */
export function hasCodeBlock(text: string): boolean {
    return extractCodeBlock(text) !== null;
}