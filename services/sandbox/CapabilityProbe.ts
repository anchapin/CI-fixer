import { SandboxEnvironment } from '../../sandbox.js';

/**
 * CapabilityProbe is responsible for detecting the tools and runtimes available
 * in a sandbox environment.
 */
export class CapabilityProbe {
  private sandbox: SandboxEnvironment;

  constructor(sandbox: SandboxEnvironment) {
    this.sandbox = sandbox;
  }

  /**
   * Probes the sandbox for a list of tools by running `tool --version`.
   * @param tools List of tool names to probe (e.g., ['node', 'python', 'pytest'])
   * @returns A map of tool names to their availability (true if available)
   */
  async probe(tools: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const tool of tools) {
      try {
        const { exitCode } = await this.sandbox.runCommand(`${tool} --version`);
        // exitCode 0 usually means the tool exists and responded to --version
        // Some tools might return non-zero for --version but still exist, 
        // but for standard dev tools, 0 is a safe bet.
        // Also, exit code 127 is specifically "command not found".
        results.set(tool, exitCode === 0);
      } catch (error) {
        results.set(tool, false);
      }
    }

    return results;
  }
}
