
import { AppConfig } from '../types.js';
import * as path from 'path';
import { unifiedGenerate, extractCode } from './llm/LLMService.js';

export class TestGenerator {
    constructor(private config: AppConfig) {}

    async generateTest(sourcePath: string, sourceContent: string): Promise<string> {
        const prompt = `
You are an expert software engineer.
Generate a minimal unit test for the following file: "${sourcePath}"

Source Code:
\`\`\`
${sourceContent}
\`\`\`

The test should be written using the standard testing framework for the language (e.g., Vitest for TypeScript, Pytest for Python).
Return ONLY the code for the test file within a markdown code block.
`;
        
        const response = await unifiedGenerate(this.config, {
            contents: prompt,
            model: "gemini-3-pro-preview", // Use smart model for generation
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
