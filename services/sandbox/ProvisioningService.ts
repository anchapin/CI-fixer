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

  private static readonly RUNNER_MAPPING: Record<string, ToolRuntime> = {
    'pytest': 'python',
    'unittest': 'python',
    'tox': 'python',
    'vitest': 'node',
    'jest': 'node',
    'mocha': 'node',
  };

  constructor(sandbox: SandboxEnvironment) {
    this.sandbox = sandbox;
  }

  /**
   * Updates the sandbox environment with discovered binary paths.
   */
  private async updateSandboxPath(newPath: string): Promise<void> {
    if (!this.sandbox.envOverrides) {
        this.sandbox.envOverrides = {};
    }

    const currentPath = this.sandbox.envOverrides['PATH'] || '$PATH';
    
    // Avoid duplicates
    if (!currentPath.includes(newPath)) {
        this.sandbox.envOverrides['PATH'] = `${currentPath}:${newPath}`;
        console.log(`[Provisioning] Updated sandbox PATH override: ${this.sandbox.envOverrides['PATH']}`);
    }
  }

  /**
   * Ensures a test runner is available in the sandbox.
   * If not found, attempts to install it automatically.
   */
  async ensureRunner(runner: string): Promise<boolean> {
    // Check if runner exists
    try {
      const { exitCode } = await this.sandbox.runCommand(`which ${runner}`);
      if (exitCode === 0) {
        return true;
      }
    } catch (e) {
      // Ignore error, proceed to installation
    }

    // Try to install
    const runtime = ProvisioningService.RUNNER_MAPPING[runner] || 'unknown';
    if (runtime === 'unknown') {
      return false;
    }

    console.log(`[Provisioning] Test runner '${runner}' missing. Attempting installation...`);
    return this.provision(runner, runtime);
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
    return this.getNpmPrefix().then(p => p ? `${p}/bin` : null);
  }

  private async getNpmPrefix(): Promise<string | null> {
    try {
      const { stdout, exitCode } = await this.sandbox.runCommand('npm config get prefix');
      if (exitCode === 0 && stdout.trim()) {
        return stdout.trim();
      }
    } catch (e) {
      // Ignore errors when getting npm prefix
    }
    return null;
  }

  private async getPythonUserBase(): Promise<string | null> {
    try {
      const { stdout, exitCode } = await this.sandbox.runCommand('python3 -m site --user-base');
      if (exitCode === 0 && stdout.trim()) {
        return stdout.trim();
      }
      // Fallback to python if python3 fails
      const { stdout: stdout2, exitCode: exitCode2 } = await this.sandbox.runCommand('python -m site --user-base');
      if (exitCode2 === 0 && stdout2.trim()) {
        return stdout2.trim();
      }
    } catch (e) {
      // Ignore errors
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
      // Use python -m pip for robustness
      command = `python3 -m pip install --user ${tool} || python -m pip install --user ${tool} || pip install --user ${tool}`;
    } else {
      return false;
    }

    try {
      const { exitCode } = await this.sandbox.runCommand(command);
      if (exitCode === 0) {
        // Post-installation path refresh
        if (runtime === 'node') {
          const prefix = await this.getNpmPrefix();
          if (prefix) await this.updateSandboxPath(`${prefix}/bin`);
        } else if (runtime === 'python') {
          const userBase = await this.getPythonUserBase();
          if (userBase) await this.updateSandboxPath(`${userBase}/bin`);
        }
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }
}
