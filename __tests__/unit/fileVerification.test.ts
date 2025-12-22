import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findUniqueFile } from '../../utils/fileVerification';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('fileVerification', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-verification-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('findUniqueFile', () => {
        it('should return the path if the file exists at the specified location', async () => {
            const filePath = path.join(tempDir, 'direct.ts');
            fs.writeFileSync(filePath, 'test');

            const result = await findUniqueFile('direct.ts', tempDir);
            expect(result.found).toBe(true);
            expect(result.path).toBe(filePath);
        });

        it('should return the path if exactly one match is found elsewhere', async () => {
            const subDir = path.join(tempDir, 'src');
            fs.mkdirSync(subDir);
            const filePath = path.join(subDir, 'uniqueFile.ts');
            fs.writeFileSync(filePath, 'test');

            const result = await findUniqueFile('uniqueFile.ts', tempDir);
            expect(result.found).toBe(true);
            expect(result.path).toBe(filePath);
        });

        it('should return multiple matches if more than one is found', async () => {
            const dir1 = path.join(tempDir, 'src');
            const dir2 = path.join(tempDir, 'lib');
            fs.mkdirSync(dir1);
            fs.mkdirSync(dir2);
            const path1 = path.join(dir1, 'duplicate.ts');
            const path2 = path.join(dir2, 'duplicate.ts');
            fs.writeFileSync(path1, 'test');
            fs.writeFileSync(path2, 'test');

            const result = await findUniqueFile('duplicate.ts', tempDir);
            expect(result.found).toBe(false);
            expect(result.matches).toContain(path1);
            expect(result.matches).toContain(path2);
            expect(result.matches.length).toBe(2);
        });

        it('should return not found if no matches exist', async () => {
            const result = await findUniqueFile('nonexistent.ts', tempDir);
            expect(result.found).toBe(false);
            expect(result.matches).toHaveLength(0);
        });

        it('should return the path if an absolute path is provided and exists', async () => {
            const filePath = path.join(tempDir, 'absolute.ts');
            fs.writeFileSync(filePath, 'test');

            const result = await findUniqueFile(filePath, tempDir);
            expect(result.found).toBe(true);
            expect(result.path).toBe(filePath);
        });

        it('should return not found if the specified path is a directory', async () => {
            const subDir = path.join(tempDir, 'a-directory');
            fs.mkdirSync(subDir);

            const result = await findUniqueFile('a-directory', tempDir);
            expect(result.found).toBe(false);
        });

        it('should ignore files in common ignore directories', async () => {
            const nodeModules = path.join(tempDir, 'node_modules');
            fs.mkdirSync(nodeModules);
            const filePath = path.join(nodeModules, 'ignored.ts');
            fs.writeFileSync(filePath, 'test');

            const result = await findUniqueFile('ignored.ts', tempDir);
            expect(result.found).toBe(false);
            expect(result.matches).toHaveLength(0);
        });
    });
});
