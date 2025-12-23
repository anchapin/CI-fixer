import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We will test the agent_tools.ts logic. 
import { readFile } from '../../services/sandbox/agent_tools';

describe('Path Verification Integration in agent_tools', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeAll(() => {
        originalCwd = process.cwd();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-verification-test-'));
        process.chdir(tempDir);

        // Setup file structure
        fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'src', 'target.txt'), 'TARGET_CONTENT');
        
        fs.mkdirSync(path.join(tempDir, 'lib'), { recursive: true });
        // Create a duplicate to test ambiguity
        fs.writeFileSync(path.join(tempDir, 'lib', 'duplicate.txt'), 'DUPLICATE_1');
        fs.mkdirSync(path.join(tempDir, 'other'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'other', 'duplicate.txt'), 'DUPLICATE_2');
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should read existing file correctly', async () => {
        const content = await readFile('src/target.txt');
        expect(content).toBe('TARGET_CONTENT');
    });

    it('should auto-correct path if unique match found', async () => {
        // We ask for a wrong path, but the file exists at src/target.txt (unique)
        const content = await readFile('wrong/path/target.txt');
        
        expect(content).toBe('TARGET_CONTENT');
    });

    it('should fail if multiple matches found', async () => {
        // duplicate.txt exists in lib/ and other/
        const content = await readFile('wrong/path/duplicate.txt');
        
        expect(content).toContain('Error reading file');
        expect(content).toContain('multiple candidates were found');
        expect(content).toContain('duplicate.txt');
    });

    it('should fail if no matches found', async () => {
        const content = await readFile('wrong/path/nonexistent.txt');
        expect(content).toContain('Error reading file');
        expect(content).not.toContain('multiple candidates');
    });
});