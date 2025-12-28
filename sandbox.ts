import { Sandbox } from '@e2b/code-interpreter';
import { AppConfig } from './types.js';

// Define types for Node modules to avoid 'any' if possible, or just use any for simplicity in this refactor
// relying on dynamic imports to avoid bundler issues.

export interface SandboxEnvironment {
    // Setup
    init(): Promise<void>;
    teardown(): Promise<void>;

    // Execution
    runCommand(command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    // Alias for compatibility
    exec(command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;

    // File I/O
    writeFile(path: string, content: string): Promise<void>;
    readFile(path: string): Promise<string>;
    listFiles(path?: string): Promise<Map<string, string>>;

    // Workdir context
    getWorkDir(): string;
    getLocalPath(): string;

    // ID for logging
    getId(): string;

    // Environment management
    envOverrides?: Record<string, string>;
}

export class DockerSandbox implements SandboxEnvironment {
    private containerId: string | null = null;
    private readonly imageName: string;
    private readonly workspaceDir = '/workspace';
    private readonly containerName: string;
    public envOverrides: Record<string, string> = {};

    // Node module references
    private execAsync: any;
    private spawn: any;
    private fs: any;
    private path: any;
    private os: any;

    constructor(imageName: string = 'ci-fixer-sandbox') {
        this.imageName = imageName;
        this.containerName = `agent-${Math.random().toString(36).substr(2, 9)}`;
    }

    private async loadModules() {
        if (typeof process === 'undefined') {
            throw new Error("DockerSandbox is only supported in Node.js environment");
        }
        const cp = await import('child_process');
        const util = await import('util');
        this.execAsync = util.promisify(cp.exec);
        this.spawn = cp.spawn;
        this.fs = await import('fs/promises');
        this.path = await import('path');
        this.os = await import('os');
    }

    async init(): Promise<void> {
        await this.loadModules();
        console.log(`[Docker] Starting container ${this.containerName} with image ${this.imageName}...`);
        // Start the container detached, keeping it alive with tail -f /dev/null
        const cmd = `docker run -d --rm --name ${this.containerName} -w ${this.workspaceDir} ${this.imageName} tail -f /dev/null`;
        try {
            const { stdout } = await this.execAsync(cmd);
            this.containerId = stdout.trim();
            console.log(`[Docker] Container started: ${this.containerId}`);
        } catch (error: any) {
            throw new Error(`Failed to start Docker container: ${error.message}`);
        }
    }

    async teardown(): Promise<void> {
        if (this.containerId) {
            console.log(`[Docker] Stopping container ${this.containerName}...`);
            try {
                // Ensure modules loaded (might be called before init if init failed? unlikely but safe check)
                if (!this.execAsync) await this.loadModules();
                await this.execAsync(`docker stop ${this.containerName}`); // --rm will handle removal
            } catch (error) {
                console.warn(`[Docker] Failed to stop container: ${error}`);
            }
            this.containerId = null;
        }
    }

    async runCommand(command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        if (!this.containerId) throw new Error("Sandbox not initialized");
        if (!this.spawn) await this.loadModules();

        console.log(`[Docker] Executing: ${command}`);

        const envPrefix = Object.entries(this.envOverrides)
            .map(([key, value]) => `${key}=${value}`)
            .join(' ');
        
        const fullCommand = envPrefix ? `${envPrefix} ${command}` : command;

        return new Promise((resolve) => {
            // using spawn to avoid shell quoting hell on Windows host
            const child = this.spawn('docker', ['exec', this.containerName, '/bin/bash', '-c', fullCommand]);

            let stdout = '';
            let stderr = '';

            const timeout = options?.timeout ? setTimeout(() => {
                child.kill();
                resolve({ stdout, stderr: stderr + "\nExecution Timed Out", exitCode: 124 });
            }, options.timeout) : null;

            child.stdout.on('data', (data: any) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: any) => {
                stderr += data.toString();
            });

            child.on('close', (code: number) => {
                if (timeout) clearTimeout(timeout);
                resolve({
                    stdout,
                    stderr,
                    exitCode: code || 0
                });
            });

            child.on('error', (err: any) => {
                if (timeout) clearTimeout(timeout);
                resolve({
                    stdout,
                    stderr: err.message,
                    exitCode: 1
                });
            });
        });
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        if (!this.containerId) throw new Error("Sandbox not initialized");
        if (!this.fs) await this.loadModules();

        // Strategy: Write to local temp file, then docker cp
        const tempDir = this.os.tmpdir();
        const tempFile = this.path.join(tempDir, `upload-${Math.random().toString(36).substr(2, 9)}`);

        await this.fs.writeFile(tempFile, content);

        const destPath = this.path.isAbsolute(filePath) ? filePath : this.path.posix.join(this.workspaceDir, filePath);

        try {
            // Ensure parent directory exists? docker cp might not need it if we copy to a file path?
            // Actually docker cp typically works. But let's be safe and mkdir -p dirname
            const dirName = this.path.posix.dirname(destPath);
            if (dirName !== '.' && dirName !== '/') {
                await this.runCommand(`mkdir -p ${dirName}`);
            }

            await this.execAsync(`docker cp ${tempFile} ${this.containerName}:${destPath}`);
        } finally {
            await this.fs.unlink(tempFile);
        }
    }

    async readFile(filePath: string): Promise<string> {
        if (!this.containerId) throw new Error("Sandbox not initialized");
        if (!this.path) await this.loadModules();

        // Strategy: docker exec cat
        const destPath = this.path.isAbsolute(filePath) ? filePath : this.path.posix.join(this.workspaceDir, filePath);
        const { stdout, exitCode } = await this.runCommand(`cat ${destPath}`);

        if (exitCode !== 0) {
            throw new Error(`Failed to read file ${filePath}`);
        }
        return stdout;
    }

    async listFiles(dirPath: string = '.'): Promise<Map<string, string>> {
        if (!this.containerId) throw new Error("Sandbox not initialized");
        const { stdout, exitCode } = await this.runCommand(`find ${dirPath} -maxdepth 2 -not -path '*/.*'`);
        if (exitCode !== 0) return new Map();
        
        const files = new Map<string, string>();
        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
            files.set(line, ""); // Just paths for now to match minimal requirement
        }
        return files;
    }

    getWorkDir(): string {
        return this.workspaceDir;
    }

    getLocalPath(): string {
        return this.workspaceDir;
    }

    getId(): string {
        return this.containerId || 'unknown';
    }

    async exec(command: string) { return this.runCommand(command); }
}

export class E2BSandbox implements SandboxEnvironment {
    private sandbox: Sandbox | undefined;
    private readonly apiKey: string;
    private readonly browserProxy: boolean;
    public envOverrides: Record<string, string> = {};

    constructor(apiKey: string, browserProxy: boolean = false) {
        this.apiKey = apiKey;
        this.browserProxy = browserProxy;
    }

    async init(): Promise<void> {
        const sandboxOpts: any = { apiKey: this.apiKey };
        // Browser proxy handling logic from original code
        // (Simulated here if we are server-side, but if we are in browser we would need window.location)
        // Assuming this runs in Node server or client. 
        // If running in Node, browserProxy might mean we are setting up for a client that needs proxying?
        // Actually the original code had `if (IS_BROWSER)`.

        // Adapting logic:
        if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
            sandboxOpts.apiUrl = window.location.origin + '/api/e2b';
        }

        this.sandbox = await Sandbox.create(sandboxOpts);

        if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
            const sbAny = this.sandbox as any;
            if (sbAny.connectionConfig) {
                const originalGetSandboxUrl = sbAny.connectionConfig.getSandboxUrl.bind(sbAny.connectionConfig);
                sbAny.connectionConfig.getSandboxUrl = (sandboxId: string, opts: any) => {
                    const originalUrl = originalGetSandboxUrl(sandboxId, opts);
                    const targetHost = originalUrl.replace(/^https?:\/\//, '');
                    return window.location.origin + '/api/sandbox_exec/' + targetHost;
                };
            }
        }
    }

    async teardown(): Promise<void> {
        if (this.sandbox) {
            await this.sandbox.kill();
            this.sandbox = undefined;
        }
    }

    async runCommand(command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        if (!this.sandbox) throw new Error("Sandbox not initialized");
        
        const envPrefix = Object.entries(this.envOverrides)
            .map(([key, value]) => `${key}=${value}`)
            .join(' ');
        
        const fullCommand = envPrefix ? `${envPrefix} ${command}` : command;
        // Convert ms to seconds for E2B
        const timeoutSeconds = options?.timeout ? Math.ceil(options.timeout / 1000) : undefined;
        const res = await this.sandbox.runCode(fullCommand, { language: 'bash' }); // runCode doesn't take timeout in this version? 
        // If it doesn't, we can use an alternative or just ignore for now. 
        // The sandbox object might have a timeout property.

        const stdout = res.logs.stdout.join('\n');
        const stderr = res.logs.stderr.join('\n');

        // E2B SDK returns error object if something went wrong with execution wrapper, 
        // but exit code is usually inside result?
        // Actually e2b result doesn't explicitly have exitCode in this simpler `runCode`.
        // We might validly assume 0 if no error?
        // Wait, `runCode` returns `ExecutionResult` which has `error` if exception occurred.

        if (res.error) {
            return { stdout, stderr: stderr + "\n" + res.error.value, exitCode: 1 };
        }

        return { stdout, stderr, exitCode: 0 };
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        if (!this.sandbox) throw new Error("Sandbox not initialized");
        await this.sandbox.files.write(filePath, content);
    }

    async readFile(filePath: string): Promise<string> {
        if (!this.sandbox) throw new Error("Sandbox not initialized");
        return await this.sandbox.files.read(filePath);
    }

    async listFiles(dirPath: string = '.'): Promise<Map<string, string>> {
        if (!this.sandbox) throw new Error("Sandbox not initialized");
        const list = await this.sandbox.files.list(dirPath);
        const files = new Map<string, string>();
        for (const item of list) {
            files.set(item.name, "");
        }
        return files;
    }

    getWorkDir(): string {
        return '/home/user'; // Default E2B workdir usually
    }

    getLocalPath(): string {
        return '/home/user';
    }

    getId(): string {
        return this.sandbox?.sandboxId || 'unknown';
    }

    // Helper to get raw sandbox if needed
    getRawSandbox(): Sandbox | undefined {
        return this.sandbox;
    }

    async exec(command: string) { return this.runCommand(command); }
}

// Simulation Sandbox for fallback/testing
export class SimulationSandbox implements SandboxEnvironment {
    async init(): Promise<void> { console.log('[Simulation] Initialized'); }
    async teardown(): Promise<void> { console.log('[Simulation] Teardown'); }

    async runCommand(command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        return {
            stdout: `[SIMULATION] Executed: ${command}\n> (Mock Output)`,
            stderr: "",
            exitCode: 0
        };
    }

    async writeFile(path: string, content: string): Promise<void> {
        console.log(`[Simulation] Write file: ${path}`);
    }

    async readFile(path: string): Promise<string> {
        return `[SIMULATION] Content of ${path}`;
    }

    async listFiles(path: string = '.'): Promise<Map<string, string>> {
        return new Map([['src/app.ts', 'content']]);
    }

    getWorkDir(): string { return process.cwd().replace(/\\/g, '/'); }
    getLocalPath(): string { return process.cwd(); }
    getId(): string { return 'sim-001'; }
    async exec(command: string, options?: { timeout?: number }) { return this.runCommand(command, options); }
}

// Factory Function

export function createSandbox(config: AppConfig): SandboxEnvironment {
    if (config.executionBackend === 'docker_local') {
        return new DockerSandbox(config.dockerImage || 'nikolaik/python-nodejs:python3.11-nodejs20-bullseye');
    }
    if (config.devEnv === 'e2b' && config.e2bApiKey) {
        return new E2BSandbox(config.e2bApiKey);
    }

    // Default to Simulation if no backend configured
    return new SimulationSandbox();
}
