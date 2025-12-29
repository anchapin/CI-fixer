import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock child_process
vi.mock('child_process', () => {
    return {
        exec: vi.fn((cmd, opts, cb) => {
            // Handle optional options
            const callback = typeof opts === 'function' ? opts : cb;
            if (callback) callback(null, { stdout: 'mock success', stderr: '' });
            return {};
        }),
        execSync: vi.fn().mockReturnValue('')
    };
});

import { readFile, writeFile, runCmd } from '../../services/sandbox/agent_tools';
import { exec } from 'child_process';

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
        fs.writeFileSync(path.join(tempDir, 'lib', 'duplicate.txt'), 'DUPLICATE_1');
        fs.mkdirSync(path.join(tempDir, 'other'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'other', 'duplicate.txt'), 'DUPLICATE_2');
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('readFile verification', () => {
        it('should read existing file correctly', async () => {
            const content = await readFile('src/target.txt');
            expect(content).toBe('TARGET_CONTENT');
        });

        it('should auto-correct path if unique match found', async () => {
            const content = await readFile('wrong/path/target.txt');
            expect(content).toBe('TARGET_CONTENT');
        });

        it('should fail if multiple matches found', async () => {
            const content = await readFile('wrong/path/duplicate.txt');
            expect(content).toContain('Ambiguous path');
            expect(content).toContain('Found multiple candidates');
        });

        it('should fail if no matches found', async () => {
            const content = await readFile('wrong/path/nonexistent.txt');
            expect(content).toContain('File not found');
        });
    });

    describe('writeFile verification', () => {
        it('should write to existing file correctly', async () => {
            await writeFile('src/target.txt', 'NEW_CONTENT');
            const content = fs.readFileSync('src/target.txt', 'utf-8');
            expect(content).toBe('NEW_CONTENT');
            fs.writeFileSync('src/target.txt', 'TARGET_CONTENT');
        });

        it('should auto-correct path if file exists elsewhere (Unique)', async () => {
            await writeFile('wrong/path/target.txt', 'CORRECTED_WRITE');
            const content = fs.readFileSync('src/target.txt', 'utf-8');
            expect(content).toBe('CORRECTED_WRITE');
            expect(fs.existsSync('wrong/path/target.txt')).toBe(false);
            fs.writeFileSync('src/target.txt', 'TARGET_CONTENT');
        });

        it('should fail if multiple matches found', async () => {
            const result = await writeFile('wrong/path/duplicate.txt', 'AMBIGUOUS_WRITE');
            expect(result).toContain('Ambiguous path');
            expect(result).toContain('Found multiple candidates');
        });
    });

    describe('runCmd verification', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should auto-correct source path in mv', async () => {
            await runCmd('mv wrong/path/target.txt destination.txt');
            
            expect(vi.mocked(exec)).toHaveBeenCalled();
            const calledCmd = vi.mocked(exec).mock.calls[0][0] as string;
            
            // It should NOT have the wrong path
            expect(calledCmd).not.toContain('wrong/path/target.txt');
            // It SHOULD have the correct path (src/target.txt or absolute)
            // findUniqueFile returns absolute.
            // The command string logic might use absolute path.
            // Check if it contains 'src/target.txt' part at least.
            
            // Just check that it contains the resolved filename
            expect(calledCmd).toMatch(/src[\\/]target\.txt/); 
        });

        it('should auto-correct target path in rm', async () => {
            await runCmd('rm wrong/path/target.txt');
            const calledCmd = vi.mocked(exec).mock.calls[0][0] as string;
            expect(calledCmd).toMatch(/src[\\/]target\.txt/);
        });

        it('should auto-correct source path in cp', async () => {
            await runCmd('cp wrong/path/target.txt copy.txt');
            const calledCmd = vi.mocked(exec).mock.calls[0][0] as string;
            expect(calledCmd).toMatch(/src[\\/]target\.txt/);
        });

        it('should NOT correct if multiple matches (mv)', async () => {
            const result = await runCmd('mv wrong/path/duplicate.txt dest.txt');
             expect(vi.mocked(exec)).not.toHaveBeenCalled();
             expect(result).toContain('Found multiple candidates');
        });
    });
});