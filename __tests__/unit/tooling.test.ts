
import { describe, it, expect } from 'vitest';
import { extractFileOutline } from '../../services/analysis/CodeAnalysisService.js';

describe('Tooling: Code Analysis', () => {

    it('should extract outlines from TypeScript file', () => {
        const tsCode = `
import foo from 'bar';

export class UserManager {
    constructor() {}

    async getUser(id: string) {
        return "user";
    }
}

function helper() { return 1; }
        `;
        const outline = extractFileOutline(tsCode, 'typescript');
        expect(outline).toContain('class UserManager');
        expect(outline).toContain('async getUser');
        expect(outline).toContain('function helper');
        expect(outline).toContain('## File Outline');
    });

    it('should extract outlines from Python file', () => {
        const pyCode = `
import os

class DataProcessor:
    def __init__(self):
        pass
    
    def process(self, data):
        return True

def main():
    print("hello")
        `;
        const outline = extractFileOutline(pyCode, 'python');
        expect(outline).toContain('class DataProcessor');
        expect(outline).toContain('def process');
        expect(outline).toContain('def main');
    });

    it('should handle empty structure gracefully', () => {
        const code = `// just comments\nconst x = 1;`;
        const outline = extractFileOutline(code, 'typescript');
        // Simple var declarations aren't matched by my regex currently unless they are const x = () => ...
        // Wait, "const x = 1" shouldn't match.
        expect(outline).toContain("No structure found");
    });
});
