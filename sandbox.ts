import { Sandbox } from '@e2b/code-interpreter';
import { AppConfig } from './types.js';
import * as k8s from '@kubernetes/client-node';

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

    // Resource monitoring (optional, for DockerSandbox)
    getResourceStats?(): Promise<ResourceStats | null>;
}

export interface ResourceStats {
    cpuPercent: number;
    memoryUsage: string;
    memoryLimit: string;
    memoryPercent: number;
    networkRx: string;
    networkTx: string;
    blockRead: string;
    blockWrite: string;
    pids: number;
}

export interface DockerSandboxConfig {
    imageName?: string;
    cpuLimit?: string;
    memoryLimit?: string;
    pidsLimit?: number;
    networkMode?: string;
}

export class DockerSandbox implements SandboxEnvironment {
    private containerId: string | null = null;
    private readonly imageName: string;
    private readonly workspaceDir = '/workspace';
    private readonly containerName: string;
    public envOverrides: Record<string, string> = {};
    private readonly config: DockerSandboxConfig;

    // Node module references
    private execAsync: any;
    private spawn: any;
    private fs: any;
    private path: any;
    private os: any;

    constructor(imageNameOrConfig: string | DockerSandboxConfig = 'ci-fixer-sandbox') {
        // Support both string (backward compat) and config object
        if (typeof imageNameOrConfig === 'string') {
            this.imageName = imageNameOrConfig;
            this.config = {};
        } else {
            this.imageName = imageNameOrConfig.imageName || 'ci-fixer-sandbox';
            this.config = imageNameOrConfig;
        }
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

        // Build docker run command with resource limits
        const resourceFlags: string[] = [];

        // CPU limit (default: 1 CPU core)
        const cpuLimit = this.config.cpuLimit || process.env.DOCKER_CPU_LIMIT || '1';
        resourceFlags.push(`--cpus=${cpuLimit}`);

        // Memory limit (default: 2GB)
        const memoryLimit = this.config.memoryLimit || process.env.DOCKER_MEMORY_LIMIT || '2g';
        resourceFlags.push(`--memory=${memoryLimit}`);

        // PIDs limit (default: 1000 to prevent fork bombs)
        const pidsLimit = this.config.pidsLimit || parseInt(process.env.DOCKER_PIDS_LIMIT || '1000');
        resourceFlags.push(`--pids-limit=${pidsLimit}`);

        // Network mode (optional)
        if (this.config.networkMode) {
            resourceFlags.push(`--network=${this.config.networkMode}`);
        }

        // Start the container detached, keeping it alive with tail -f /dev/null
        const cmd = `docker run -d --rm --name ${this.containerName} ${resourceFlags.join(' ')} -w ${this.workspaceDir} ${this.imageName} tail -f /dev/null`;

        console.log(`[Docker] Resource limits: CPU=${cpuLimit}, Memory=${memoryLimit}, PIDs=${pidsLimit}`);

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

    /**
     * Get resource usage statistics for the container using docker stats
     * Returns null if container is not running or stats cannot be retrieved
     */
    async getResourceStats(): Promise<ResourceStats | null> {
        if (!this.containerId) return null;
        if (!this.execAsync) await this.loadModules();

        try {
            // docker stats --no-stream --format json returns JSON output
            const { stdout } = await this.execAsync(
                `docker stats ${this.containerId} --no-stream --format "{{.CPUPerc}},{{.MemUsage}},{{.NetIO}},{{.BlockIO}},{{.PIDs}}"`
            );

            const parts = stdout.trim().split(',');
            if (parts.length !== 5) return null;

            const [cpuPercent, memUsage, netIO, blockIO, pids] = parts;

            // Parse memory usage (e.g., "1.2GiB / 2GiB")
            const [memoryUsage, memoryLimit] = memUsage.trim().split(/\s*\/\s*/);

            // Parse memory percent
            const memoryPercent = parseFloat(memoryUsage) / parseFloat(memoryLimit) * 100;

            // Parse network I/O (e.g., "1.2MB / 3.4MB")
            const [networkRx, networkTx] = netIO.trim().split(/\s*\/\s*/);

            // Parse block I/O (e.g., "10MB / 5MB")
            const [blockRead, blockWrite] = blockIO.trim().split(/\s*\/\s*/);

            return {
                cpuPercent: parseFloat(cpuPercent.replace('%', '')),
                memoryUsage,
                memoryLimit,
                memoryPercent,
                networkRx,
                networkTx,
                blockRead,
                blockWrite,
                pids: parseInt(pids.trim())
            };
        } catch (error) {
            console.warn(`[Docker] Failed to get resource stats: ${error}`);
            return null;
        }
    }
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

// Kubernetes Sandbox for native K8s Job execution
export class KubernetesSandbox implements SandboxEnvironment {
    private kc: k8s.KubeConfig;
    private batchApi: k8s.BatchApi;
    private coreApi: k8s.CoreV1Api;
    private readonly jobId: string;
    private readonly namespace: string;
    private readonly jobName: string;
    private readonly podName: string;
    private readonly imageName: string;
    public envOverrides: Record<string, string> = {};
    private readonly workspaceDir = '/workspace';
    private podCreated = false;

    constructor(imageName: string = 'nikolaik/python-nodejs:python3.11-nodejs20-bullseye', namespace: string = 'default') {
        this.imageName = imageName;
        this.namespace = namespace;
        this.jobId = Math.random().toString(36).substr(2, 9);
        this.jobName = `ci-fixer-sandbox-${this.jobId}`;
        this.podName = `${this.jobName}-pod`;

        // Initialize Kubernetes config
        this.kc = new k8s.KubeConfig();
        try {
            // Try to load from cluster (in-cluster config)
            this.kc.loadFromDefault();
        } catch (e) {
            // If in-cluster fails, try kubeconfig
            try {
                this.kc.loadFromDefault({ /* use default kubeconfig path */ });
            } catch (e2: any) {
                throw new Error(`Failed to load Kubernetes config: ${e2.message}`);
            }
        }

        this.batchApi = this.kc.makeApiClient(k8s.BatchApi);
        this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    }

    async init(): Promise<void> {
        console.log(`[Kubernetes] Creating Job ${this.jobName} with image ${this.imageName}...`);

        // Define the Job manifest
        const job: k8s.V1Job = {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: {
                name: this.jobName,
                labels: {
                    app: 'ci-fixer-sandbox',
                    'job-id': this.jobId
                }
            },
            spec: {
                backoffLimit: 0,
                ttlSecondsAfterFinished: 300, // Clean up after 5 minutes
                template: {
                    metadata: {
                        labels: {
                            app: 'ci-fixer-sandbox',
                            'job-id': this.jobId
                        }
                    },
                    spec: {
                        restartPolicy: 'Never',
                        serviceAccountName: 'ci-fixer-sandbox', // RBAC service account
                        containers: [{
                            name: 'sandbox',
                            image: this.imageName,
                            command: ['tail', '-f', '/dev/null'], // Keep container alive
                            workingDir: this.workspaceDir,
                            env: [
                                { name: 'PATH', value: '/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
                            ],
                            resources: {
                                limits: {
                                    cpu: '1',
                                    memory: '2Gi'
                                },
                                requests: {
                                    cpu: '250m',
                                    memory: '512Mi'
                                }
                            }
                        }]
                    }
                }
            }
        };

        try {
            // Create the Job
            await this.batchApi.createNamespacedJob(this.namespace, job);
            console.log(`[Kubernetes] Job created: ${this.jobName}`);

            // Wait for the pod to be running
            await this.waitForPod();
            this.podCreated = true;
        } catch (error: any) {
            throw new Error(`Failed to create Kubernetes Job: ${error.message}`);
        }
    }

    private async waitForPod(timeoutMs: number = 60000): Promise<void> {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            try {
                const pods = await this.coreApi.listNamespacedPod(
                    this.namespace,
                    undefined, undefined, undefined, undefined,
                    `job-id=${this.jobId}`
                );

                if (pods.items.length > 0) {
                    const pod = pods.items[0];
                    const phase = pod.status?.phase;

                    if (phase === 'Running') {
                        console.log(`[Kubernetes] Pod is running: ${pod.metadata?.name}`);
                        this.podName = pod.metadata?.name || this.podName;
                        return;
                    }

                    if (phase === 'Failed' || phase === 'Succeeded') {
                        throw new Error(`Pod ${this.podName} failed to start properly (phase: ${phase})`);
                    }
                }
            } catch (e: any) {
                if (e.message?.includes('failed to start')) throw e;
                // Continue waiting for other errors
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`Timeout waiting for pod ${this.podName} to be running`);
    }

    async teardown(): Promise<void> {
        if (this.podCreated) {
            console.log(`[Kubernetes] Deleting Job ${this.jobName}...`);
            try {
                // Deleting the Job will also delete the Pod due to ownerReferences
                const deleteOptions = {
                    propagationPolicy: 'Foreground' as k8s.V1DeleteOptionsPropagationPolicy
                };
                await this.batchApi.deleteNamespacedJob(this.jobName, this.namespace, undefined, deleteOptions);
                console.log(`[Kubernetes] Job deleted successfully`);
            } catch (error: any) {
                console.warn(`[Kubernetes] Failed to delete Job: ${error}`);
            }
            this.podCreated = false;
        }
    }

    async runCommand(command: string, options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        if (!this.podCreated) {
            throw new Error("Sandbox not initialized. Call init() first.");
        }

        try {
            // Build environment variable overrides
            const envVars = Object.entries(this.envOverrides)
                .map(([key, value]) => `${key}=${value}`)
                .join(' ');

            const fullCommand = envVars ? `${envVars} ${command}` : command;

            // Execute command in the pod
            const resp = await this.coreApi.connectToNamespacedPodExec(
                this.podName,
                this.namespace,
                'sandbox',
                ['sh', '-c', fullCommand],
                {
                    stdin: false,
                    stdout: true,
                    stderr: true,
                    tty: false
                }
            );

            // Parse the exec response
            return new Promise((resolve, reject) => {
                let stdout = '';
                let stderr = '';

                resp.on('data', (chunk: Buffer) => {
                    // The exec response multiplexes stdout and stderr
                    // Format: <stream_type><data>
                    // Stream types: 1 = stdout, 2 = stderr
                    let offset = 0;
                    while (offset < chunk.length) {
                        const streamType = chunk[offset];
                        const dataLength = chunk.readUInt32BE(offset + 1);
                        const dataStart = offset + 5;
                        const dataEnd = dataStart + dataLength;

                        if (dataEnd > chunk.length) break;

                        const data = chunk.subarray(dataStart, dataEnd).toString();

                        if (streamType === 1) stdout += data;
                        else if (streamType === 2) stderr += data;

                        offset = dataEnd;
                    }
                });

                const timeout = options?.timeout || 30000;
                const timeoutHandle = setTimeout(() => {
                    reject(new Error(`Command execution timeout after ${timeout}ms`));
                }, timeout);

                resp.on('end', () => {
                    clearTimeout(timeoutHandle);
                    // Assume exit code 0 if we got here without error
                    resolve({ stdout, stderr, exitCode: 0 });
                });

                resp.on('error', (err: Error) => {
                    clearTimeout(timeoutHandle);
                    resolve({ stdout, stderr: stderr + '\n' + err.message, exitCode: 1 });
                });
            });
        } catch (error: any) {
            return {
                stdout: '',
                stderr: `Execution error: ${error.message}`,
                exitCode: 1
            };
        }
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        if (!this.podCreated) {
            throw new Error("Sandbox not initialized. Call init() first.");
        }

        const command = `cat > ${filePath} << 'EOF'\n${content}\nEOF`;
        const result = await this.runCommand(command);

        if (result.exitCode !== 0) {
            throw new Error(`Failed to write file ${filePath}: ${result.stderr}`);
        }
    }

    async readFile(filePath: string): Promise<string> {
        if (!this.podCreated) {
            throw new Error("Sandbox not initialized. Call init() first.");
        }

        const result = await this.runCommand(`cat ${filePath}`);

        if (result.exitCode !== 0) {
            throw new Error(`Failed to read file ${filePath}: ${result.stderr}`);
        }

        return result.stdout;
    }

    async listFiles(dirPath: string = '.'): Promise<Map<string, string>> {
        if (!this.podCreated) {
            throw new Error("Sandbox not initialized. Call init() first.");
        }

        const result = await this.runCommand(`ls -la ${dirPath}`);

        if (result.exitCode !== 0) {
            throw new Error(`Failed to list files in ${dirPath}: ${result.stderr}`);
        }

        const files = new Map<string, string>();
        const lines = result.stdout.split('\n').slice(1); // Skip header line

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 8) {
                const name = parts.slice(8).join(' ');
                const type = parts[0].startsWith('d') ? 'directory' : 'file';
                files.set(name, type);
            }
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
        return this.jobId;
    }

    async exec(command: string, options?: { timeout?: number }) {
        return this.runCommand(command, options);
    }
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
    if (config.executionBackend === 'kubernetes') {
        return new KubernetesSandbox(config.dockerImage || 'nikolaik/python-nodejs:python3.11-nodejs20-bullseye');
    }
    if (config.executionBackend === 'docker_local') {
        return new DockerSandbox(config.dockerImage || 'nikolaik/python-nodejs:python3.11-nodejs20-bullseye');
    }
    if (config.devEnv === 'e2b' && config.e2bApiKey) {
        return new E2BSandbox(config.e2bApiKey);
    }

    // Default to Simulation if no backend configured
    return new SimulationSandbox();
}
