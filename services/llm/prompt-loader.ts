import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface PromptMetadata {
    version: string;
    model: string;
    temperature?: number;
    max_tokens?: number;
    response_format?: string;
    description?: string;
    variables?: string[];
}

export interface PromptTemplate {
    metadata: PromptMetadata;
    content: string;
    compiled: HandlebarsTemplateDelegate;
    filePath: string;
}

export interface LLMConfig {
    maxOutputTokens?: number;
    temperature?: number;
    responseMimeType?: string;
    systemInstruction?: string;
}

// Template cache for performance
const templateCache = new Map<string, PromptTemplate>();

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

/**
 * Parses YAML frontmatter from prompt template.
 */
function parsePromptFrontmatter(content: string): { metadata: PromptMetadata; body: string } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
        throw new Error('Invalid prompt template: missing frontmatter');
    }

    const [, frontmatterText, body] = match;

    // Simple YAML parser
    const metadata: any = {};
    const lines = frontmatterText.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Handle arrays
        if (trimmed.includes('[')) {
            const [key, value] = trimmed.split(':').map(s => s.trim());
            try {
                metadata[key] = JSON.parse(value);
            } catch {
                metadata[key] = value;
            }
        } else {
            // Handle simple key: value
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmed.substring(0, colonIndex).trim();
                let value: any = trimmed.substring(colonIndex + 1).trim();

                // Remove quotes
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }

                // Parse numbers
                if (!isNaN(Number(value)) && value !== '') {
                    value = Number(value);
                }

                metadata[key] = value;
            }
        }
    }

    return { metadata: metadata as PromptMetadata, body };
}

// ============================================================================
// TEMPLATE LOADING
// ============================================================================

/**
 * Loads a prompt template from file.
 * 
 * @param name - Template name (e.g., 'diagnosis/error-diagnosis')
 * @param version - Template version (e.g., 'v1'). Defaults to 'v1'
 * @returns Compiled Handlebars template with metadata
 */
export async function loadPrompt(name: string, version: string = 'v1'): Promise<PromptTemplate> {
    const cacheKey = `${name}-${version}`;

    // Check cache first
    if (templateCache.has(cacheKey)) {
        return templateCache.get(cacheKey)!;
    }

    const promptsDir = path.join(__dirname, '../../prompts');
    const filePath = path.join(promptsDir, `${name}-${version}.md`);

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { metadata, body } = parsePromptFrontmatter(content);

        // Compile Handlebars template
        const compiled = Handlebars.compile(body, {
            noEscape: true, // Don't HTML-escape variables
            strict: false   // Allow missing variables
        });

        const template: PromptTemplate = {
            metadata,
            content: body,
            compiled,
            filePath
        };

        // Cache the template
        templateCache.set(cacheKey, template);

        return template;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            throw new Error(`Prompt template not found: ${name}-${version}.md`);
        }
        throw new Error(`Failed to load prompt template ${name}-${version}: ${error.message}`);
    }
}

/**
 * Renders a prompt template with variables.
 * 
 * @param template - Loaded prompt template
 * @param variables - Variables to substitute in the template
 * @returns Rendered prompt string
 */
export function renderPrompt(
    template: PromptTemplate,
    variables: Record<string, any>
): string {
    try {
        return template.compiled(variables);
    } catch (error: any) {
        throw new Error(`Failed to render prompt template: ${error.message}`);
    }
}

/**
 * Extracts LLM configuration from prompt metadata.
 */
export function getPromptConfig(template: PromptTemplate): LLMConfig {
    const config: LLMConfig = {};

    if (template.metadata.max_tokens) {
        config.maxOutputTokens = template.metadata.max_tokens;
    }

    if (template.metadata.temperature !== undefined) {
        config.temperature = template.metadata.temperature;
    }

    if (template.metadata.response_format) {
        config.responseMimeType = template.metadata.response_format;
    }

    return config;
}

/**
 * Lists all available versions of a prompt template.
 * 
 * @param name - Template name (e.g., 'diagnosis/error-diagnosis')
 * @returns Array of version strings (e.g., ['v1', 'v2'])
 */
export async function listPromptVersions(name: string): Promise<string[]> {
    const promptsDir = path.join(__dirname, '../../prompts');
    const dirPath = path.dirname(path.join(promptsDir, name));
    const baseName = path.basename(name);

    try {
        const files = await fs.readdir(dirPath);
        const versions: string[] = [];

        const pattern = new RegExp(`^${baseName}-(v\\d+)\\.md$`);

        for (const file of files) {
            const match = file.match(pattern);
            if (match) {
                versions.push(match[1]);
            }
        }

        return versions.sort();
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

/**
 * Clears the template cache.
 * Useful for development/testing when templates are modified.
 */
export function clearPromptCache(): void {
    templateCache.clear();
}

// ============================================================================
// HANDLEBARS HELPERS
// ============================================================================

// Register custom Handlebars helpers
Handlebars.registerHelper('json', function (context) {
    return JSON.stringify(context, null, 2);
});

Handlebars.registerHelper('truncate', function (str: string, length: number) {
    if (typeof str !== 'string') return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
});

Handlebars.registerHelper('uppercase', function (str: string) {
    return typeof str === 'string' ? str.toUpperCase() : '';
});

Handlebars.registerHelper('lowercase', function (str: string) {
    return typeof str === 'string' ? str.toLowerCase() : '';
});
