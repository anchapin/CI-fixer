
/**
 * Code Analysis Service
 * Provides static analysis tools to understand code structure without full parsing.
 */

export function extractFileOutline(content: string, language: string): string {
    const lines = content.split('\n');
    const outline: string[] = [];

    // Regex patterns
    const patterns = {
        typescript: [
            /^\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/, // function foo
            /^\s*(?:export\s+)?const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/, // const foo = () =>
            /^\s*(?:export\s+)?class\s+([a-zA-Z0-9_]+)/, // class Foo
            /^\s*(?:export\s+)?interface\s+([a-zA-Z0-9_]+)/, // interface Foo
            /^\s*(?:export\s+)?type\s+([a-zA-Z0-9_]+)/, // type Foo
            /^\s*(?:async\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/, // Method: async foo() : Type {
        ],
        python: [
            /^\s*def\s+([a-zA-Z0-9_]+)\s*\(/, // def foo(
            /^\s*class\s+([a-zA-Z0-9_]+)/, // class Foo
        ]
    };

    const langPatterns = language === 'python' ? patterns.python : patterns.typescript;

    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        for (const pattern of langPatterns) {
            const match = line.match(pattern); // Match against original line to preserve indentation significance if identifying nesting (future)
            // Ideally we check indentation, but for a rough outline, line content is enough.
            if (match) {
                outline.push(`${idx + 1}: ${trimmed.substring(0, 80)}${trimmed.length > 80 ? '...' : ''}`);
                break;
            }
        }
    });

    if (outline.length === 0) {
        return "No structure found (or file is empty/unsupported language).";
    }

    return "## File Outline\n" + outline.join('\n');
}
