
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { DockerSandbox } from '../../sandbox';
import * as fs from 'fs';

describe('DockerSandbox Integration', () => {
    // Increase timeout for docker operations
    const timeout = 60000;
    let sandbox: DockerSandbox;

    beforeAll(() => {
        sandbox = new DockerSandbox('node:20-bullseye');
    });

    afterAll(async () => {
        if (sandbox) {
            await sandbox.teardown();
        }
    });

    it('should initialize the sandbox', async () => {
        await sandbox.init();
        expect(sandbox.getId()).toBeDefined();
        expect(sandbox.getId()).not.toBe('unknown');
    }, timeout);

    it('should execute a simple command', async () => {
        const result = await sandbox.runCommand('echo "Hello Docker"');
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('Hello Docker');
    }, timeout);

    it('should read and write files', async () => {
        const filename = 'test.txt';
        const content = 'Hello File System';

        await sandbox.writeFile(filename, content);

        const readContent = await sandbox.readFile(filename);
        expect(readContent.trim()).toBe(content);

        // Verify with ls
        const lsResult = await sandbox.runCommand('ls');
        expect(lsResult.stdout).toContain(filename);
    }, timeout);

    it('should handle command errors', async () => {
        const result = await sandbox.runCommand('ls non_existent_file');
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('No such file');
    }, timeout);

    it('should maintain state (workdir)', async () => {
        // Create a directory
        await sandbox.runCommand('mkdir subdir');
        await sandbox.runCommand('touch subdir/file.txt');

        const result = await sandbox.runCommand('ls subdir');
        expect(result.stdout).toContain('file.txt');
    });
});
