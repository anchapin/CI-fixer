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
  /**
   * Probes the sandbox for a list of tools by running `tool --version`.
   * @param tools List of tool names to probe (e.g., ['node', 'npm', 'pytest'])
   * @returns A map of tool names to their availability (true if available)
   */
  async probe(tools: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const tool of tools) {
      try {
        const { exitCode } = await this.sandbox.runCommand(`${tool} --version`);
        results.set(tool, exitCode === 0);
      } catch (error) {
        results.set(tool, false);
      }
    }

    return results;
  }

  /**
   * Identifies the tools required by the project by analyzing manifest files
   * (e.g., package.json, requirements.txt).
   * @returns A list of required tool names.
   */
  async getRequiredTools(): Promise<string[]> {
    const required = new Set<string>();

    // Check for Node.js
    try {
      const packageJsonContent = await this.sandbox.readFile('package.json');
      if (packageJsonContent) {
        required.add('node');
        required.add('npm');
        const pkg = JSON.parse(packageJsonContent);
        
        // Detect specific runners
        const allDeps = { 
          ...(pkg.dependencies || {}), 
          ...(pkg.devDependencies || {}) 
        };
        
        if (allDeps['vitest']) required.add('vitest');
        if (allDeps['jest']) required.add('jest');
        if (allDeps['playwright']) required.add('playwright');
      }
    } catch (e) {
      // package.json doesn't exist
    }

    // Check for Python
    try {
      const requirementsContent = await this.sandbox.readFile('requirements.txt');
      if (requirementsContent) {
        required.add('python');
        required.add('pip');
        
        if (requirementsContent.includes('pytest')) required.add('pytest');
        if (requirementsContent.includes('flake8')) required.add('flake8');
        if (requirementsContent.includes('black')) required.add('black');
      }
    } catch (e) {
      // requirements.txt doesn't exist
    }

    return Array.from(required);
  }
}
