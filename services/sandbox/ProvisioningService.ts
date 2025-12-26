import { SandboxEnvironment } from '../../sandbox.js';

export type ToolRuntime = 'node' | 'python' | 'unknown';

/**
 * ProvisioningService is responsible for installing missing tools and runtimes
 * in the sandbox environment.
 */
export class ProvisioningService {
  private sandbox: SandboxEnvironment;
  private cachedPathCommand: string | null = null;
  private attemptRegistry = new Map<string, number>();
  private readonly MAX_ATTEMPTS = 3;

  constructor(sandbox: SandboxEnvironment) {
    this.sandbox = sandbox;
  }

  /**
   * Generates a shell command to refresh the PATH to include global binary locations.
   * @returns A command string like "export PATH=$PATH:/usr/local/bin"
   */
  async getPathRefreshCommand(): Promise<string> {
    if (this.cachedPathCommand) return this.cachedPathCommand;

    try {
      // Find npm global bin directory
      const { stdout, exitCode } = await this.sandbox.runCommand('npm config get prefix');
      if (exitCode === 0 && stdout.trim()) {
        const prefix = stdout.trim();
        // Typically <prefix>/bin on Linux
        this.cachedPathCommand = `export PATH=$PATH:${prefix}/bin`;
        return this.cachedPathCommand;
      }
    } catch (e) {
      // Fallback
    }

    return '';
  }

  /**
   * Returns the global binary path for the current runtime.
   */
  async getGlobalBinPath(): Promise<string | null> {
    try {
      const { stdout, exitCode } = await this.sandbox.runCommand('npm config get prefix');
      if (exitCode === 0 && stdout.trim()) {
        return `${stdout.trim()}/bin`;
      }
    } catch (e) {
      // Ignore errors when getting npm prefix
    }
    return null;
  }

  /**
   * Attempts to install a missing tool in the sandbox.
   * @param tool The name of the tool to install (e.g., 'vitest', 'pytest')
   * @param runtime The runtime associated with the tool
   * @returns true if installation succeeded
   */
  async provision(tool: string, runtime: ToolRuntime): Promise<boolean> {
    const attempts = this.attemptRegistry.get(tool) || 0;
    if (attempts >= this.MAX_ATTEMPTS) {
      return false;
    }

    this.attemptRegistry.set(tool, attempts + 1);

    let command = '';

    if (runtime === 'node') {
      command = `npm install -g ${tool}`;
    } else if (runtime === 'python') {
      command = `pip install ${tool}`;
    } else {
      return false;
    }

    try {
      const { exitCode } = await this.sandbox.runCommand(command);
      return exitCode === 0;
    } catch (error) {
      return false;
    }
  }
}
