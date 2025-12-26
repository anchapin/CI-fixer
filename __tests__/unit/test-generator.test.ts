
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestGenerator } from '../../services/TestGenerator.js';
import * as LLMService from '../../services/llm/LLMService.js';

vi.mock('../../services/llm/LLMService.js', () => ({
    unifiedGenerate: vi.fn(),
    extractCode: vi.fn((text) => text), // Simple pass-through for mock
    safeJsonParse: vi.fn((text, fallback) => fallback)
}));

describe('TestGenerator', () => {
    let generator: TestGenerator;
    const mockConfig = {} as any;

    beforeEach(() => {
        generator = new TestGenerator(mockConfig);
        vi.clearAllMocks();
    });

    it('should generate a test file content for a given source file', async () => {
        const sourcePath = 'src/utils/math.ts';
        const sourceContent = 'export function add(a: number, b: number) { return a + b; }';
        
        // Mock LLM response
        (LLMService.unifiedGenerate as any).mockResolvedValue({
            text: '```typescript\nimport { describe, it, expect } from "vitest";\nimport { add } from "../math";\n\ndescribe("add", () => {\n  it("adds two numbers", () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});\n```'
        });

        const testContent = await generator.generateTest(sourcePath, sourceContent);

        expect(testContent).toContain('describe("add"');
        expect(testContent).toContain('expect(add(1, 2)).toBe(3)');
        expect(LLMService.unifiedGenerate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                contents: expect.stringContaining('Generate a minimal unit test')
            })
        );
    });

    it('should determine the correct test file path', () => {
        const sourcePath = 'src/utils/math.ts';
        const testPath = generator.determineTestPath(sourcePath);
        // Assuming we place tests in __tests__/unit/ or similar, or co-located?
        // The plan says: "Place the new test in a __tests__ directory adjacent to the modified file (or tests/ for Python)."
        // Let's assume co-location with suffix for now or follow common patterns. 
        // Spec says: "__tests__/ adjacent to the file or tests/ for Python."
        
        // Let's implement logic: 
        // src/utils/math.ts -> src/utils/__tests__/math.test.ts
        expect(testPath).toBe('src/utils/__tests__/math.test.ts');
    });

    it('should determine correct test path for Python', () => {
        const sourcePath = 'backend/app/main.py';
        const testPath = generator.determineTestPath(sourcePath);
        // backend/app/main.py -> backend/app/tests/test_main.py or backend/tests/test_main.py?
        // Spec says "tests/ for Python". Usually python tests are in a `tests` folder.
        // Let's go with adjacent `tests/` folder.
        expect(testPath).toBe('backend/app/tests/test_main.py');
    });
});
