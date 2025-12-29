import { ReproductionInferenceResult, AppConfig, ReproductionFailureContext } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { unifiedGenerate, safeJsonParse } from './llm/LLMService';
import { SandboxEnvironment } from '../sandbox';

/**
 * Service responsible for inferring the reproduction command for a repository
 * when it is missing from agent output.
 */
export class ReproductionInferenceService {
  constructor() {}

  /**
   * Infers a reproduction command for the given repository path.
   * @param repoPath The absolute path to the repository root
   * @param config Optional application configuration for LLM-based inference
   * @param sandbox Optional sandbox environment to perform validation dry-runs
   * @param failureContext Optional context about the CI failure to narrow down inference
   * @returns The inferred reproduction command and details, or null if inference failed
   */
  async inferCommand(
    repoPath: string, 
    config?: AppConfig, 
    sandbox?: SandboxEnvironment,
    failureContext?: ReproductionFailureContext
  ): Promise<ReproductionInferenceResult | null> {
    const strategies = [
      () => this.inferFromWorkflowLLM(repoPath, config, failureContext),
      () => this.inferFromWorkflows(repoPath, failureContext),
      () => this.inferFromSignatures(repoPath),
      () => this.inferFromBuildTools(repoPath),
      () => this.inferFromAgentRetry(repoPath, config),
      () => this.inferFromSafeScan(repoPath)
    ];

    for (const strategy of strategies) {
      const result = await strategy();
      if (result) {
        if (sandbox) {
          const isValid = await this.validateCommand(result.command, sandbox);
          if (isValid) {
            return result;
          } else {
            console.warn(`[ReproductionInferenceService] Command failed dry-run: ${result.command}. Trying next strategy.`);
            continue;
          }
        }
        return result;
      }
    }

    return null;
  }

  private async inferFromWorkflowLLM(repoPath: string, config?: AppConfig, context?: ReproductionFailureContext): Promise<ReproductionInferenceResult | null> {
    if (!config || !context?.workflowPath || !context?.logText) return null;

    try {
      const fullPath = path.isAbsolute(context.workflowPath) 
        ? context.workflowPath 
        : path.join(repoPath, context.workflowPath);
      
      const workflowContent = await fs.readFile(fullPath, 'utf8');

      const prompt = `
You are an expert developer assistant. I need to reproduce a CI failure.
I have the GitHub Workflow file that failed and a snippet of the CI log.

WORKFLOW FILE:
\`\`\`yaml
${workflowContent}
\`\`\`

CI LOG SNIPPET:
\`\`\`
${context.logText.slice(-3000)}
\`\`\`

Based on the workflow and the log, identify the EXACT shell command that failed. 
Focus on the command in the 'run' field of the failing step.
Ignore setup commands (install, setup-node, etc.) unless they are the cause of the failure.

Return your answer in JSON format:
{
  "command": "the failing shell command",
  "reasoning": "brief explanation of why this command was chosen based on the log"
}
`;

      const response = await unifiedGenerate(config, {
        contents: prompt,
        responseFormat: 'json'
      });

      const parsed = safeJsonParse(response.text, null as any);
      if (parsed && parsed.command) {
        return {
          command: parsed.command,
          confidence: 0.95,
          strategy: 'workflow',
          reasoning: parsed.reasoning || `Pinpointed by LLM from workflow: ${path.basename(context.workflowPath)}`
        };
      }
    } catch (error) {
      console.error('[ReproductionInferenceService] LLM Workflow Pinpointing failed:', error);
    }

    return null;
  }

  private async validateCommand(command: string, sandbox: SandboxEnvironment): Promise<boolean> {
    try {
      // Perform a basic dry-run. We don't necessarily care about the exit code 
      // (since reproduction is EXPECTED to fail), but we care about "command not found".
      // Usually "command not found" is exit code 127 on Unix.
      const res = await sandbox.runCommand(command);
      
      if (res.exitCode === 127 || res.stderr.toLowerCase().includes('command not found')) {
        return false;
      }
      
      return true;
    } catch {
      return false;
    }
  }

  private async inferFromSafeScan(repoPath: string): Promise<ReproductionInferenceResult | null> {
    try {
      const files = await fs.readdir(repoPath);
      
      // 1. Look for test directories
      const testDirs = ['tests', 'test', 'spec', 'specs', '__tests__'];
      for (const dir of testDirs) {
        if (files.includes(dir)) {
          const stats = await fs.stat(path.join(repoPath, dir));
          if (stats.isDirectory()) {
            return {
              command: this.getCommandForTestDir(dir, files),
              confidence: 0.5,
              strategy: 'safe_scan',
              reasoning: `Found test directory: ${dir}`
            };
          }
        }
      }

      // 2. Look for test files at root
      const testFilePatterns = ['test.py', 'test.js', 'test.ts', 'tests.py'];
      for (const file of testFilePatterns) {
        if (files.includes(file)) {
          return {
            command: this.getCommandForTestFile(file),
            confidence: 0.5,
            strategy: 'safe_scan',
            reasoning: `Found test file: ${file}`
          };
        }
      }
    } catch (error) {
      console.error('[ReproductionInferenceService] Safe Scan failed:', error);
    }

    return null;
  }

  private getCommandForTestDir(dir: string, allFiles: string[]): string {
    if (allFiles.includes('package.json')) return `npm test -- ${dir}`;
    if (allFiles.includes('requirements.txt') || allFiles.includes('setup.py')) return `pytest ${dir}`;
    if (allFiles.includes('go.mod')) return `go test ./${dir}/...`;
    return `ls ${dir}`; // Fallback: just list it
  }

  private getCommandForTestFile(file: string): string {
    if (file.endsWith('.py')) return `python ${file}`;
    if (file.endsWith('.js')) return `node ${file}`;
    if (file.endsWith('.ts')) return `npx ts-node ${file}`;
    return `./${file}`;
  }

  private async inferFromAgentRetry(repoPath: string, config?: AppConfig): Promise<ReproductionInferenceResult | null> {
    if (!config) return null;

    try {
      // List top-level files to provide context to the LLM
      const files = await fs.readdir(repoPath);
      const fileContext = files.slice(0, 50).join(', ');

      const prompt = `
You are an expert developer assistant. I need to reproduce a CI failure in this repository, but I don't know the exact test command.
The repository root contains the following files: ${fileContext}

Based on these files, please infer the most likely command to run the tests and reproduce the failure.
Return your answer in JSON format:
{
  "command": "the test command",
  "reasoning": "brief explanation of why this command was chosen"
}
`;

      const response = await unifiedGenerate(config, {
        contents: prompt,
        responseFormat: 'json'
      });

      const parsed = safeJsonParse(response.text, null as any);
      if (parsed && parsed.command) {
        return {
          command: parsed.command,
          confidence: 0.6,
          strategy: 'agent_retry',
          reasoning: parsed.reasoning || 'Inferred by agent through repository structure analysis'
        };
      }
    } catch (error) {
      console.error('[ReproductionInferenceService] Agent Retry failed:', error);
    }

    return null;
  }

  private async inferFromBuildTools(repoPath: string): Promise<ReproductionInferenceResult | null> {
    // 1. Makefile
    try {
      const makefilePath = path.join(repoPath, 'Makefile');
      const content = await fs.readFile(makefilePath, 'utf8');
      if (content.includes('test:') || content.includes('check:')) {
        return {
          command: 'make test',
          confidence: 0.7,
          strategy: 'build_tool',
          reasoning: 'Detected Makefile with test/check target'
        };
      }
    } catch (e) {
      void 0;
    }

    // 2. Gradle
    try {
      await fs.stat(path.join(repoPath, 'build.gradle'));
      return {
        command: './gradlew test',
        confidence: 0.7,
        strategy: 'build_tool',
        reasoning: 'Detected Gradle project'
      };
    } catch (e) {
      void 0;
    }

    // 3. Maven
    try {
      await fs.stat(path.join(repoPath, 'pom.xml'));
      return {
        command: 'mvn test',
        confidence: 0.7,
        strategy: 'build_tool',
        reasoning: 'Detected Maven project'
      };
    } catch (e) {
      void 0;
    }

    // 4. Ruby/Rake
    try {
      await fs.stat(path.join(repoPath, 'Rakefile'));
      return {
        command: 'rake test',
        confidence: 0.7,
        strategy: 'build_tool',
        reasoning: 'Detected Rakefile'
      };
    } catch (e) {
      void 0;
    }

    return null;
  }

  private async inferFromSignatures(repoPath: string): Promise<ReproductionInferenceResult | null> {
    const signatures: Array<{ files: string[], command: string, confidence: number, reasoning: string }> = [
      {
        files: ['package.json'],
        command: 'npm test',
        confidence: 0.8,
        reasoning: 'Detected Node.js project (package.json)'
      },
      {
        files: ['bun.lockb', 'bunfig.toml'],
        command: 'bun test',
        confidence: 0.8,
        reasoning: 'Detected Bun project'
      },
      {
        files: ['pytest.ini', 'tox.ini', '.pytest_cache'],
        command: 'pytest',
        confidence: 0.8,
        reasoning: 'Detected Python pytest configuration'
      },
      {
        files: ['requirements.txt', 'setup.py', 'pyproject.toml'],
        command: 'pytest',
        confidence: 0.7,
        reasoning: 'Detected Python project'
      },
      {
        files: ['go.mod'],
        command: 'go test ./...',
        confidence: 0.8,
        reasoning: 'Detected Go project (go.mod)'
      },
      {
        files: ['Cargo.toml'],
        command: 'cargo test',
        confidence: 0.8,
        reasoning: 'Detected Rust project (Cargo.toml)'
      }
    ];

    for (const sig of signatures) {
      for (const file of sig.files) {
        try {
          await fs.stat(path.join(repoPath, file));
          return {
            command: sig.command,
            confidence: sig.confidence,
            strategy: 'signature',
            reasoning: sig.reasoning
          };
        } catch {
          void 0;
        }
      }
    }

    return null;
  }

  private async inferFromWorkflows(repoPath: string, context?: ReproductionFailureContext): Promise<ReproductionInferenceResult | null> {
    const workflowsDir = path.join(repoPath, '.github/workflows');
    
    try {
      // 1. If we have a specific workflow path, try that FIRST
      if (context?.workflowPath) {
        const fullPath = path.isAbsolute(context.workflowPath) 
          ? context.workflowPath 
          : path.join(repoPath, context.workflowPath);
        
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const result = this.parseWorkflowContent(content, path.basename(context.workflowPath));
          if (result) return result;
        } catch (e) {
          console.warn(`[ReproductionInferenceService] Could not read targeted workflow: ${context.workflowPath}`);
          // Fall through to generic scan if targeted workflow can't be read
        }
      }

      // 2. Fallback to generic scan of all workflows if no specific one was provided or it failed
      const stats = await fs.stat(workflowsDir);
      if (!stats.isDirectory()) return null;

      const files = await fs.readdir(workflowsDir);
      const yamlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

      for (const file of yamlFiles) {
        // Skip the one we already tried if we have context AND successfully processed it
        // Or if we specifically only want to target the given workflow (future enhancement)
        if (context?.workflowPath && path.basename(context.workflowPath) === file) continue;

        const filePath = path.join(workflowsDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const result = this.parseWorkflowContent(content, file);
        if (result) return result;
      }
    } catch {
      // Workflows directory might not exist or other FS issues
      return null;
    }

    return null;
  }

  private parseWorkflowContent(content: string, fileName: string): ReproductionInferenceResult | null {
    try {
      const doc = yaml.load(content) as any;
      if (!doc || !doc.jobs) return null;

      for (const jobKey in doc.jobs) {
        const job = doc.jobs[jobKey];
        if (!job.steps || !Array.isArray(job.steps)) continue;

        for (const step of job.steps) {
          if (step.run && typeof step.run === 'string') {
            const command = step.run.trim();
            
            // Filter out common setup commands
            if (this.isTestLikeCommand(command)) {
              return {
                command,
                confidence: 0.9,
                strategy: 'workflow',
                reasoning: `Extracted from GitHub Workflow: ${fileName}, job: ${jobKey}${step.name ? `, step: ${step.name}` : ''}`
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[ReproductionInferenceService] Failed to parse YAML for ${fileName}`);
    }
    return null;
  }

  private isTestLikeCommand(command: string): boolean {
    const cmd = command.toLowerCase();
    
    // Look for test keywords
    const testKeywords = ['test', 'pytest', 'vitest', 'jest', 'mocha', 'cypress', 'playwright', 'check', 'verify', 'tox', 'nosetests', 'unittest', 'go test', 'cargo test'];
    const hasTestKeyword = testKeywords.some(k => cmd.includes(k));

    if (!hasTestKeyword) return false;

    // Ignore if it's ONLY a setup command (rare if it has a test keyword, but for safety)
    const setupKeywords = ['actions/checkout', 'actions/setup'];
    const isPureSetup = setupKeywords.some(k => cmd === k);
    if (isPureSetup) return false;
    
    return true;
  }
}
