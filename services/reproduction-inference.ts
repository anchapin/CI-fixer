import { ReproductionInferenceResult } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Service responsible for inferring the reproduction command for a repository
 * when it is missing from agent output.
 */
export class ReproductionInferenceService {
  /**
   * Infers a reproduction command for the given repository path.
   * @param repoPath The absolute path to the repository root
   * @returns The inferred reproduction command and details, or null if inference failed
   */
  async inferCommand(repoPath: string): Promise<ReproductionInferenceResult | null> {
    const workflowResult = await this.inferFromWorkflows(repoPath);
    if (workflowResult) return workflowResult;

    return null;
  }

  private async inferFromWorkflows(repoPath: string): Promise<ReproductionInferenceResult | null> {
    const workflowsDir = path.join(repoPath, '.github/workflows');
    
    try {
      const stats = await fs.stat(workflowsDir);
      if (!stats.isDirectory()) return null;

      const files = await fs.readdir(workflowsDir);
      const yamlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

      for (const file of yamlFiles) {
        const filePath = path.join(workflowsDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const doc = yaml.load(content) as any;

        if (!doc || !doc.jobs) continue;

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
                  reasoning: `Extracted from GitHub Workflow: ${file}, job: ${jobKey}`
                };
              }
            }
          }
        }
      }
    } catch (error) {
      // Workflows directory might not exist or other FS issues
      return null;
    }

    return null;
  }

  private isTestLikeCommand(command: string): boolean {
    const cmd = command.toLowerCase();
    
    // Ignore common setup steps
    if (cmd.includes('npm install') || cmd.includes('npm ci') || cmd.includes('yarn install') || cmd.includes('pnpm install')) return false;
    if (cmd.includes('actions/checkout') || cmd.includes('actions/setup')) return false;
    if (cmd.startsWith('pip install') || cmd.startsWith('python -m pip install')) return false;
    
    // Look for test keywords
    const testKeywords = ['test', 'pytest', 'vitest', 'jest', 'mocha', 'cypress', 'playwright', 'check', 'verify'];
    return testKeywords.some(k => cmd.includes(k));
  }
}
