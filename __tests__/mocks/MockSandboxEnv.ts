
import { SandboxEnvironment } from '../../sandbox.js';
// ExecutionResult might not be exported from sandbox.js, check sandbox.ts.
// If it is not exported, I will use 'any' or define it locally.

export class MockSandboxEnv implements SandboxEnvironment {
    public id = "mock-env-id";
    public files: Map<string, string> = new Map();
    public commands: string[] = [];

    getId(): string {
        return this.id;
    }

    async init(): Promise<void> {
        // no-op
    }

    async runCommand(command: string, opts?: any): Promise<any> {
        this.commands.push(command);
        console.log(`[MockSandbox] Executing: ${command}`);

        if (command.startsWith('cat ')) {
            const file = command.split(' ')[1];
            if (this.files.has(file)) {
                return { stdout: this.files.get(file)!, stderr: "", exitCode: 0, outputs: [] };
            }
            return { stdout: "", stderr: "File not found", exitCode: 1, outputs: [] };
        }

        return { stdout: "Mock Success", stderr: "", exitCode: 0, outputs: [] };
    }

    async writeFile(path: string, content: string): Promise<void> {
        console.log(`[MockSandbox] Writing file: ${path}`);
        this.files.set(path, content);
    }

    async readFile(path: string): Promise<string> {
        if (this.files.has(path)) return this.files.get(path)!;
        throw new Error(`File not found: ${path}`);
    }

    getWorkDir(): string {
        return "/home/user/repo";
    }

    getLocalPath(): string {
        return "/home/user/repo";
    }

    async teardown(): Promise<void> {
        // no-op
    }

    async kill(): Promise<void> { }

    async exec(command: string) { return this.runCommand(command); }
}
