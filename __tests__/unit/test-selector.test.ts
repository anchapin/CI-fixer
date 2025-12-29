
import { describe, it, expect } from 'vitest';
import { TestSelector } from '../../services/TestSelector.js';

describe('TestSelector', () => {
    const selector = new TestSelector();

    it('should select pytest for Python files', () => {
        const files = ['backend/main.py', 'backend/utils.py'];
        const command = selector.selectTestCommand(files);
        expect(command).toBe('python -m pytest');
    });

    it('should select pytest for requirements.txt', () => {
        const files = ['requirements.txt'];
        const command = selector.selectTestCommand(files);
        expect(command).toBe('python -m pytest');
    });

    it('should select npm run test:frontend for frontend files', () => {
        const files = ['src/components/Button.tsx', 'src/utils/format.ts'];
        const command = selector.selectTestCommand(files);
        expect(command).toBe('npm run test:frontend');
    });

    it('should select npm run test:backend for backend typescript files', () => {
        const files = ['server/api.ts', 'server/db.ts'];
        // Assuming we configure the selector to recognize 'server/' as backend
        const command = selector.selectTestCommand(files);
        expect(command).toBe('npm run test:backend');
    });

    it('should select full suite for package.json', () => {
        const files = ['package.json'];
        const command = selector.selectTestCommand(files);
        expect(command).toBe('npm test'); 
    });

    it('should prefer broader scope if mixed', () => {
        const files = ['backend/main.py', 'src/components/Button.tsx'];
        // If both python and frontend TS are modified, maybe run both or a specific integration command?
        // For now, let's assume we want to be safe and run everything if it's a mix that implies full stack changes
        // OR return a combined command
        const command = selector.selectTestCommand(files);
        expect(command).toBe('npm test && python -m pytest'); 
    });
    
    it('should return default command if no mapping found', () => {
        const files = ['README.md'];
        const command = selector.selectTestCommand(files);
        expect(command).toBe('npm test'); // Default fallback
    });
});
