
import { AppConfig, CodeFile } from '../../types.js';
import { SandboxEnvironment } from '../../sandbox.js';

export class MockSandboxService {
    private mockFiles = new Map<string, string>(); // Path -> Content
    public commandHistory: string[] = [];
    public activeId = 'mock-sandbox-id';

    constructor() { }

    // ============================================
    // Mocked Utility Helper
    // ============================================
    public setFile(path: string, content: string) {
        this.mockFiles.set(path, content);
    }

    public getFile(path: string): string | undefined {
        return this.mockFiles.get(path);
    }

    // ============================================
    // Mocked Service Methods
    // ============================================

    public prepareSandbox = async (config: AppConfig): Promise<SandboxEnvironment> => {
        // Return a mocked SandboxEnvironment-like object
        return {
            getId: () => this.activeId,
            runCommand: async (cmd: string) => {
                this.commandHistory.push(cmd);

                // Simple mocks for standard commands
                if (cmd.startsWith('cat ')) {
                    const file = cmd.split(' ')[1];
                    if (this.mockFiles.has(file)) {
                        return { stdout: this.mockFiles.get(file)!, stderr: '', exitCode: 0, outputs: [] };
                    }
                    return { stdout: '', stderr: `cat: ${file}: No such file or directory`, exitCode: 1, outputs: [] };
                }

                if (cmd === 'ls' || cmd.startsWith('ls ')) {
                    const files = Array.from(this.mockFiles.keys()).join('\n');
                    return { stdout: files, stderr: '', exitCode: 0, outputs: [] };
                }

                if (cmd.startsWith('grep ')) {
                    return { stdout: '', stderr: '', exitCode: 1, outputs: [] }; // Nothing found by default
                }

                return { stdout: 'Mock Command Success', stderr: '', exitCode: 0, outputs: [] };
            },
            writeFile: async (path: string, content: string) => {
                this.mockFiles.set(path, content);
            },
            init: async () => { },
            kill: async () => { }
        } as unknown as SandboxEnvironment;
    };

    public runDevShellCommand = async (config: AppConfig, command: string, sandbox?: SandboxEnvironment) => {
        this.commandHistory.push(command);
        return {
            output: "Mock Shell Output",
            exitCode: 0
        };
    };

    public toolCodeSearch = async () => [];
    public toolSemanticCodeSearch = async () => [];
    public toolLintCheck = async () => ({ valid: true });
    public toolScanDependencies = async () => "No issues";
    public toolWebSearch = async () => "Mock Web Search Results";
    public createTools = (config: any) => ({});
}
