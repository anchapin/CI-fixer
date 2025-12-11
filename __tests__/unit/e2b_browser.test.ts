import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks
const mocks = vi.hoisted(() => ({
    sandboxRunCode: vi.fn(),
    sandboxKill: vi.fn(),
    getHost: vi.fn((port) => `${port}-mock-id.mock-domain`)
}));

// Mock E2B Code Interpreter
vi.mock('@e2b/code-interpreter', () => {
    return {
        Sandbox: {
            create: vi.fn(async (_opts) => {
                // Return a plain object that mimics the Sandbox instance
                return {
                    runCode: mocks.sandboxRunCode,
                    kill: mocks.sandboxKill,
                    getHost: mocks.getHost,
                    // Mimic internal property if needed by other logic
                    envdApiUrl: 'https://mock.e2b.app'
                };
            })
        }
    };
});

describe('E2B Browser Connectivity (Proxy Patch)', () => {
    beforeEach(() => {
        vi.resetModules(); // CRITICAL: Reset modules to re-evaluate top-level IS_BROWSER check
        vi.clearAllMocks();

        // Manually mock window to simulate browser environment in Node
        (global as any).window = {
            location: {
                origin: 'http://localhost:3000',
            },
            document: {} // IS_BROWSER checks for window.document too
        };

        // Default successful runCode
        mocks.sandboxRunCode.mockResolvedValue({
            logs: { stdout: ['Connection Verified'], stderr: [] },
            error: null
        });
    });

    afterEach(() => {
        delete (global as any).window;
    });

    it('should patch jupyterUrl getter to verify browser proxy usage', async () => {
        // Dynamically import services so IS_BROWSER is evaluated with our mocked window
        const { testE2BConnection } = await import('../../services');
        const apiKey = 'e2b_valid_key_12345678901234567890';

        const result = await testE2BConnection(apiKey);

        // 1. Verify Success
        expect(result.success).toBe(true);

        // 2. Verify Sandbox Creation
        const { Sandbox } = await import('@e2b/code-interpreter');
        expect(Sandbox.create).toHaveBeenCalledWith(expect.objectContaining({ apiKey }));

        // 3. Verify Patch Application
        const createMock = Sandbox.create as any;
        const sandboxInstance = await createMock.mock.results[0].value;

        // Check if the 'jupyterUrl' property was redefined
        const patchedUrl = (sandboxInstance as any).jupyterUrl;

        // Proxy URL should be "http://localhost:3000/api/sandbox_exec/49999-mock-id.mock-domain"
        expect(patchedUrl).toBe('http://localhost:3000/api/sandbox_exec/49999-mock-id.mock-domain');
        expect(mocks.getHost).toHaveBeenCalledWith(49999);
    });
});
