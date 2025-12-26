import { SandboxEnvironment } from '../../sandbox.js';

export type ToolRuntime = 'node' | 'python' | 'unknown';

/**
 * ProvisioningService is responsible for installing missing tools and runtimes
 * in the sandbox environment.
 */
export class ProvisioningService {
  private sandbox: SandboxEnvironment;

  constructor(sandbox: SandboxEnvironment) {
    this.sandbox = sandbox;
  }

  /**
   * Attempts to install a missing tool in the sandbox.
   * @param tool The name of the tool to install (e.g., 'vitest', 'pytest')
   * @param runtime The runtime associated with the tool
   * @returns true if installation succeeded
   */
  async provision(tool: string, runtime: ToolRuntime): Promise<boolean> {
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
