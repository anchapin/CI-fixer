import { SandboxEnvironment } from '../../sandbox.js';
import { log } from '../../utils/logger.js';

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
        log('INFO', `[Provisioning] Updated sandbox PATH override: ${this.sandbox.envOverrides['PATH']}`);
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

    log('INFO', `[Provisioning] Test runner '${runner}' missing. Attempting installation...`);
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
   * Executes `pip install --dry-run --report` with provided requirements content
   * and returns the generated report.
   * @param requirementsContent The content of the requirements.txt file.
   * @returns The content of the pip dry run report (JSON string) or null if an error occurred.
   */
  async runPipDryRunReport(requirementsContent: string): Promise<string | null> {
    const tempRequirementsFile = `requirements-${Date.now()}.txt`;
    const reportFile = `pip_report-${Date.now()}.json`;

    try {
      // 1. Write requirements content to a temporary file
      await this.sandbox.writeFile(tempRequirementsFile, requirementsContent);

      // 2. Execute pip install --dry-run --report
      const pipCommand = `python3 -m pip install -r ${tempRequirementsFile} --dry-run --report ${reportFile} || python -m pip install -r ${tempRequirementsFile} --dry-run --report ${reportFile}`;
      const { exitCode, stderr } = await this.sandbox.runCommand(pipCommand);

      // If pip command itself failed, we log stderr and return null
      if (exitCode !== 0) {
        log('ERROR', `[ProvisioningService] pip dry run failed: ${stderr}`);
        return null;
      }

      // 3. Read the generated report file
      const reportContent = await this.sandbox.readFile(reportFile);

      return reportContent;
    } catch (error) {
      log('ERROR', `[ProvisioningService] Error during pip dry run report: ${error}`);
      return null;
    } finally {
      // 4. Clean up temporary files
      await this.sandbox.deleteFile(tempRequirementsFile);
      await this.sandbox.deleteFile(reportFile);
    }
  }

  /**
   * Executes `pip check` in the sandbox to verify dependency compatibility.
   * @returns An object containing success status and any detected conflict messages.
   */
  async runPipCheck(): Promise<{ success: boolean; output: string }> {
      try {
          const checkCommand = `python3 -m pip check || python -m pip check`;
          const { exitCode, stdout, stderr } = await this.sandbox.runCommand(checkCommand);

          return {
              success: exitCode === 0,
              output: exitCode === 0 ? stdout : stderr || stdout
          };
      } catch (error) {
          log('ERROR', `[ProvisioningService] Error during pip check: ${error}`);
          return { success: false, output: `Error during pip check: ${error}` };
      }
  }

  /**
   * Executes `pip install -r requirements.txt` in the sandbox.
   * @param requirementsPath The path to the requirements file. Defaults to 'requirements.txt'.
   * @returns An object containing success status and output.
   */
  async runPipInstall(requirementsPath: string = 'requirements.txt'): Promise<{ success: boolean; output: string }> {
      try {
          const installCommand = `python3 -m pip install -r ${requirementsPath} || python -m pip install -r ${requirementsPath}`;
          const { exitCode, stdout, stderr } = await this.sandbox.runCommand(installCommand);

          return {
              success: exitCode === 0,
              output: exitCode === 0 ? stdout : stderr || stdout
          };
      } catch (error) {
          log('ERROR', `[ProvisioningService] Error during pip install: ${error}`);
          return { success: false, output: `Error during pip install: ${error}` };
      }
  }

  /**
   * Executes the project's test suite in the sandbox.
   * @param testCommand The command to run the tests. Defaults to 'npm test'.
   * @returns An object containing success status and output.
   */
  async runProjectTests(testCommand: string = 'npm test'): Promise<{ success: boolean; output: string }> {
      try {
          const { exitCode, stdout, stderr } = await this.sandbox.runCommand(testCommand);

          return {
              success: exitCode === 0,
              output: exitCode === 0 ? stdout : stderr || stdout
          };
      } catch (error) {
          log('ERROR', `[ProvisioningService] Error during project tests: ${error}`);
          return { success: false, output: `Error during project tests: ${error}` };
      }
  }

  /**
   * Executes `pip-compile` with provided requirements.in content
   * and returns the generated requirements.txt content.
   * Automatically attempts to install pip-tools if not found.
   * @param requirementsInContent The content of the requirements.in file.
   * @returns The content of the generated requirements.txt file, or null if an error occurred.
   */
  async runPipCompile(requirementsInContent: string): Promise<string | null> {
      const tempRequirementsInFile = `requirements-${Date.now()}.in`;
      const tempRequirementsTxtFile = `requirements-${Date.now()}.txt`;

      try {
          // 1. Ensure pip-tools is installed
          // pip-compile is part of pip-tools package
          const installed = await this.provision('piptools', 'python'); 
          if (!installed) {
              log('ERROR', "[ProvisioningService] pip-tools is not installed and could not be provisioned.");
              return null;
          }

          // 2. Write requirements.in content to a temporary file
          await this.sandbox.writeFile(tempRequirementsInFile, requirementsInContent);

          // 3. Execute pip-compile
          // Use python -m piptools compile for robustness, as pip-compile might not be directly in PATH
          const compileCommand = `python3 -m piptools compile ${tempRequirementsInFile} -o ${tempRequirementsTxtFile} || python -m piptools compile ${tempRequirementsInFile} -o ${tempRequirementsTxtFile}`;
          const { exitCode, stderr } = await this.sandbox.runCommand(compileCommand);

          if (exitCode !== 0) {
              log('ERROR', `[ProvisioningService] pip-compile failed: ${stderr}`);
              return null;
          }

          // 4. Read the generated requirements.txt file
          const requirementsTxtContent = await this.sandbox.readFile(tempRequirementsTxtFile);

          return requirementsTxtContent;
      } catch (error) {
          log('ERROR', `[ProvisioningService] Error during pip-compile: ${error}`);
          return null;
      } finally {
          // 5. Clean up temporary files
          await this.sandbox.deleteFile(tempRequirementsInFile);
          await this.sandbox.deleteFile(tempRequirementsTxtFile);
      }
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
