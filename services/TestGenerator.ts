
import { AppConfig } from '../types.js';
import * as path from 'path';
import { unifiedGenerate, extractCode } from './llm/LLMService.js';
import { getModelForTask } from '../config/models.js';

export class TestGenerator {
    constructor(private config: AppConfig) {}

    /**
     * Generates a unit test for the given source file.
     * @param sourcePath Path to the source file
     * @param sourceContent Content of the source file
     * @param repoContext Optional context about the repository (dependencies, helpers, etc.)
     */
    async generateTest(sourcePath: string, sourceContent: string, repoContext?: string): Promise<string> {
        let contextSection = "";
        if (repoContext) {
            contextSection = `
REPOSITORY CONTEXT:
${repoContext}
`;
        }

        const prompt = `
You are an expert software engineer.
Generate a minimal unit test for the following file: "${sourcePath}"

${contextSection}

Source Code:
\`\`\`
${sourceContent}
\`\`\`

INSTRUCTIONS:
1. Use the standard testing framework detected in the Repository Context (e.g., Vitest, Jest, Pytest).
2. Reuse existing test helpers or setup files if listed in the Context.
3. Ensure imports match the project's structure (e.g., using @/ aliases if tsconfig suggests it, or relative paths).
4. Return ONLY the code for the test file within a markdown code block.
`;

        const response = await unifiedGenerate(this.config, {
            contents: prompt,
            model: getModelForTask('coding'), // Use coding model for generation
            config: { temperature: 0.2 }
        });

        return extractCode(response.text);
    }

    determineTestPath(sourcePath: string): string {
        const parsed = path.parse(sourcePath);
        
        if (sourcePath.endsWith('.py')) {
            // Python: adjacent tests/test_filename.py
            return path.join(parsed.dir, 'tests', `test_${parsed.name}.py`).replace(/\\/g, '/');
        } else {
            // TypeScript/JS: adjacent __tests__/filename.test.ext
            return path.join(parsed.dir, '__tests__', `${parsed.name}.test${parsed.ext}`).replace(/\\/g, '/');
        }
    }
}
