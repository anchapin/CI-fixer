
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { readFile } from '../../services/sandbox/agent_tools.js';

// We need to mock path to return consistent results regardless of OS
// But agent_tools uses real fs and path. 
// For integration test, we'll use a temp directory.

describe('Agent Tools - Integration (Path Hallucination)', () => {
    const tempDir = path.join(process.cwd(), 'temp_test_discovery');

    beforeEach(() => {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }
        // Create some structure
        fs.mkdirSync(path.join(tempDir, 'subdir'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'subdir', 'target.txt'), 'hello world');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should provide parent directory listing when file is not found', async () => {
        // Change working directory to tempDir
        const originalCwd = process.cwd();
        process.chdir(tempDir);

        try {
            // Target a non-existent file in an existing subdirectory
            const hallucinatedPath = 'subdir/missing.txt';
            const result = await readFile(hallucinatedPath);

            expect(result).toContain('Error: Path NOT FOUND');
            expect(result).toContain('Closest existing parent directory: \'subdir\'');
            expect(result).toContain('target.txt');
        } finally {
            process.chdir(originalCwd);
        }
    });

    it('should provide fuzzy matches if found elsewhere', async () => {
        const originalCwd = process.cwd();
        process.chdir(tempDir);

        try {
            // Target a file that exists but in a different directory
            // agent_tools should find 'subdir/target.txt' if we target 'target.txt'
            // and it doesn't exist in root.
            
            // Wait, if it finds a unique match, it AUTO-CORRECTS.
            // Requirement says: "if a targeted path does not exist, the system must automatically execute a directory listing... and provide this context"
            // If it finds a unique match, it corrects it and reads the file.
            
            const result = await readFile('wrong_path/target.txt');
            // It should find subdir/target.txt and read it.
            expect(result).toBe('hello world');
        } finally {
            process.chdir(originalCwd);
        }
    });
});
