import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareSandbox, runSandboxTest } from '../../services';
import { AppConfig, RunGroup, FileChange } from '../../types';

// Hoist mocks
const mocks = vi.hoisted(() => ({
    sandboxRunCode: vi.fn(),
    sandboxKill: vi.fn(),
    sandboxCreate: vi.fn(),
    sandboxFilesWrite: vi.fn()
}));

// Mock E2B Code Interpreter
vi.mock('@e2b/code-interpreter', () => {
    return {
        Sandbox: {
            create: mocks.sandboxCreate
        }
    };
});

describe('E2B Persistent Sandbox Tests', () => {
    const mockConfig: AppConfig = {
        githubToken: 'token',
        repoUrl: 'https://github.com/owner/repo',
        selectedRuns: [],
        devEnv: 'e2b',
        checkEnv: 'e2b',
        e2bApiKey: 'e2b_valid_key_12345678901234567890'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('prepareSandbox', () => {
        it('should create sandbox, clone repo, and checkout sha', async () => {
            const mockSandbox = {
                sandboxId: 'test-sandbox',
                runCode: mocks.sandboxRunCode,
                files: { write: mocks.sandboxFilesWrite }
            };
            mocks.sandboxCreate.mockResolvedValue(mockSandbox);

            // Mock runCode responses
            // 1. git clone
            // 2. git checkout
            // 3. ls package.json
            // 4. npm install (optional)

            mocks.sandboxRunCode.mockResolvedValue({
                logs: { stdout: [], stderr: [] },
                error: null
            });

            const sandbox = await prepareSandbox(mockConfig, 'https://github.com/owner/repo', 'sha123');

            expect(mocks.sandboxCreate).toHaveBeenCalled();
            expect(sandbox).toBe(mockSandbox);

            // Verify git clone
            expect(mocks.sandboxRunCode).toHaveBeenCalledWith(expect.stringContaining('git clone'));
            // Verify git checkout
            expect(mocks.sandboxRunCode).toHaveBeenCalledWith(expect.stringContaining('git checkout sha123'));
        });

        it('should install dependencies if package.json detected', async () => {
            const mockSandbox = {
                sandboxId: 'test-sandbox',
                runCode: mocks.sandboxRunCode
            };
            mocks.sandboxCreate.mockResolvedValue(mockSandbox);

            // Mock ls output
            mocks.sandboxRunCode.mockImplementation(async (cmd: string) => {
                if (cmd.includes('ls')) {
                    return { logs: { stdout: ['package.json'], stderr: [] } };
                }
                return { logs: { stdout: [], stderr: [] } };
            });

            await prepareSandbox(mockConfig, 'https://github.com/owner/repo');

            expect(mocks.sandboxRunCode).toHaveBeenCalledWith('npm install', expect.objectContaining({ timeoutMs: 120000 }));
        });
    });

    describe('runSandboxTest (Persistent Mode)', () => {
        it('should use existing sandbox and write file', async () => {
            const mockSandbox = {
                sandboxId: 'test-sandbox',
                runCode: mocks.sandboxRunCode,
                files: { write: mocks.sandboxFilesWrite },
                filesystem: { write: mocks.sandboxFilesWrite } // Fallback for safety in test
            };

            // Mock test command success
            mocks.sandboxRunCode.mockResolvedValue({
                logs: { stdout: ['PASS', 'Test passed'], stderr: [] },
                error: null
            });

            const fileChange = {
                path: 'src/file.ts',
                modified: { content: 'new code' }
            } as any;

            const res = await runSandboxTest(
                mockConfig,
                {} as any,
                0,
                true,
                fileChange,
                'error',
                vi.fn(),
                {},
                mockSandbox as any
            );

            expect(res.passed).toBe(true);
            expect(mocks.sandboxFilesWrite).toHaveBeenCalledWith('src/file.ts', 'new code');
            expect(mocks.sandboxRunCode).toHaveBeenCalledWith(expect.stringMatching(/npm test|pytest/));
        });

        it('should detect failure in test logs', async () => {
            const mockSandbox = {
                runCode: mocks.sandboxRunCode,
                files: { write: mocks.sandboxFilesWrite }
            };

            mocks.sandboxRunCode.mockResolvedValue({
                logs: { stdout: ['FAIL', 'Test failed'], stderr: [] },
                error: null
            });

            const res = await runSandboxTest(
                mockConfig,
                {} as any,
                0,
                true,
                { path: 'f', modified: { content: '' } } as any,
                'error',
                vi.fn(),
                {},
                mockSandbox as any
            );

            expect(res.passed).toBe(false);
            expect(res.logs).toContain('FAIL');
        });
    });
});
