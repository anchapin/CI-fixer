import { describe, it, expect, beforeEach } from 'vitest';
import { MockSandboxService } from '../../__tests__/mocks/MockSandbox.js';
import { AppConfig } from '../../types.js';

describe('MockSandbox', () => {
    let mockSandbox: MockSandboxService;
    let mockConfig: AppConfig;

    beforeEach(() => {
        mockSandbox = new MockSandboxService();
        mockConfig = {
            geminiApiKey: 'test-key',
            githubToken: 'test-token',
            e2bApiKey: 'e2b_test_key',
            tavilyApiKey: 'test-tavily',
            repoUrl: 'https://github.com/test/repo',
            prUrl: 'https://github.com/test/repo/pull/1',
            devEnv: 'e2b'
        };
    });

    describe('File Operations', () => {
        it('should set and get files', () => {
            mockSandbox.setFile('test.ts', 'console.log("test");');

            const content = mockSandbox.getFile('test.ts');
            expect(content).toBe('console.log("test");');
        });

        it('should return undefined for non-existent files', () => {
            const content = mockSandbox.getFile('nonexistent.ts');
            expect(content).toBeUndefined();
        });

        it('should overwrite existing files', () => {
            mockSandbox.setFile('test.ts', 'old content');
            mockSandbox.setFile('test.ts', 'new content');

            const content = mockSandbox.getFile('test.ts');
            expect(content).toBe('new content');
        });
    });

    describe('prepareSandbox', () => {
        it('should return sandbox environment', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            expect(sandbox).toBeDefined();
            expect(sandbox.getId()).toBe('mock-sandbox-id');
            expect(typeof sandbox.runCommand).toBe('function');
            expect(typeof sandbox.writeFile).toBe('function');
        });

        it('should provide working runCommand', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            const result = await sandbox.runCommand('echo test');
            expect(result.stdout).toBeDefined();
            expect(result.exitCode).toBe(0);
        });

        it('should provide working writeFile', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            await sandbox.writeFile('new-file.ts', 'content');

            const content = mockSandbox.getFile('new-file.ts');
            expect(content).toBe('content');
        });
    });

    describe('Command Execution', () => {
        it('should track command history', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            await sandbox.runCommand('echo test1');
            await sandbox.runCommand('echo test2');

            expect(mockSandbox.commandHistory).toContain('echo test1');
            expect(mockSandbox.commandHistory).toContain('echo test2');
            expect(mockSandbox.commandHistory).toHaveLength(2);
        });

        it('should handle cat command', async () => {
            mockSandbox.setFile('test.txt', 'file content');
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            const result = await sandbox.runCommand('cat test.txt');

            expect(result.stdout).toBe('file content');
            expect(result.exitCode).toBe(0);
        });

        it('should handle cat for non-existent file', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            const result = await sandbox.runCommand('cat missing.txt');

            expect(result.stderr).toContain('No such file or directory');
            expect(result.exitCode).toBe(1);
        });

        it('should handle ls command', async () => {
            mockSandbox.setFile('file1.ts', 'content1');
            mockSandbox.setFile('file2.ts', 'content2');
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            const result = await sandbox.runCommand('ls');

            expect(result.stdout).toContain('file1.ts');
            expect(result.stdout).toContain('file2.ts');
            expect(result.exitCode).toBe(0);
        });

        it('should handle grep command', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            const result = await sandbox.runCommand('grep pattern file.txt');

            expect(result.exitCode).toBe(1); // Nothing found by default
        });

        it('should handle generic commands', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            const result = await sandbox.runCommand('npm install');

            expect(result.stdout).toBe('Mock Command Success');
            expect(result.exitCode).toBe(0);
        });
    });

    describe('runDevShellCommand', () => {
        it('should execute command and track history', async () => {
            const result = await mockSandbox.runDevShellCommand(mockConfig, 'test-command');

            expect(result.output).toBe('Mock Shell Output');
            expect(result.exitCode).toBe(0);
            expect(mockSandbox.commandHistory).toContain('test-command');
        });

        it('should work with sandbox parameter', async () => {
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);
            const result = await mockSandbox.runDevShellCommand(mockConfig, 'echo test', sandbox);

            expect(result.output).toBe('Mock Shell Output');
            expect(result.exitCode).toBe(0);
        });
    });

    describe('Tool Methods', () => {
        it('should return empty array for toolCodeSearch', async () => {
            const result = await mockSandbox.toolCodeSearch();
            expect(result).toEqual([]);
        });

        it('should return empty array for toolSemanticCodeSearch', async () => {
            const result = await mockSandbox.toolSemanticCodeSearch();
            expect(result).toEqual([]);
        });

        it('should return valid for toolLintCheck', async () => {
            const result = await mockSandbox.toolLintCheck();
            expect(result).toEqual({ valid: true });
        });

        it('should return no issues for toolScanDependencies', async () => {
            const result = await mockSandbox.toolScanDependencies();
            expect(result).toBe('No issues');
        });

        it('should return mock results for toolWebSearch', async () => {
            const result = await mockSandbox.toolWebSearch();
            expect(result).toBe('Mock Web Search Results');
        });

        it('should return empty object for createTools', () => {
            const tools = mockSandbox.createTools({});
            expect(tools).toEqual({});
        });
    });

    describe('Integration', () => {
        it('should support full workflow', async () => {
            // Prepare sandbox
            const sandbox = await mockSandbox.prepareSandbox(mockConfig);

            // Write files
            await sandbox.writeFile('app.ts', 'const x = 1;');
            await sandbox.writeFile('test.ts', 'test code');

            // List files
            const lsResult = await sandbox.runCommand('ls');
            expect(lsResult.stdout).toContain('app.ts');
            expect(lsResult.stdout).toContain('test.ts');

            // Read file
            const catResult = await sandbox.runCommand('cat app.ts');
            expect(catResult.stdout).toBe('const x = 1;');

            // Verify command history
            expect(mockSandbox.commandHistory).toHaveLength(2);
        });
    });
});
