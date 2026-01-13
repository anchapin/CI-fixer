import { AppConfig } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate AppConfig for CLI usage
 */
export async function validateConfig(config: AppConfig): Promise<ValidationResult> {
  const errors: string[] = [];

  // Validate GitHub token
  if (!config.githubToken) {
    errors.push('GitHub token is required. Set GITHUB_TOKEN environment variable or provide in config file');
  } else if (config.githubToken.length < 10) {
    errors.push('GitHub token appears to be invalid (too short)');
  }

  // Validate repo URL
  if (!config.repoUrl) {
    errors.push('Repository URL is required. Use --repo flag or set repo.url in config file');
  } else if (!config.repoUrl.includes('/')) {
    errors.push('Invalid repository URL format. Expected: owner/repo');
  } else {
    const parts = config.repoUrl.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      errors.push('Invalid repository URL format. Expected: owner/repo');
    }
  }

  // Validate LLM configuration
  if (!config.customApiKey && !config.llmProvider) {
    errors.push('LLM API key is required. Set GEMINI_API_KEY or similar environment variable');
  }

  // Validate execution backend
  if (config.executionBackend === 'e2b' && !config.e2bApiKey) {
    errors.push('E2B API key is required when using E2B backend. Set E2B_API_KEY environment variable');
  }

  if (config.executionBackend === 'docker_local') {
    // Note: We can't actually verify Docker is running here, but we can warn
    // The actual check will happen when the agent tries to use it
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Test GitHub authentication
 */
export async function testGitHubAuth(token: string, repoUrl: string): Promise<void> {
  const [owner, repo] = repoUrl.split('/');

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitHub authentication failed. Invalid token.');
      } else if (response.status === 404) {
        throw new Error(`Repository ${owner}/${repo} not found or access denied.`);
      } else {
        throw new Error(`GitHub API error: ${response.statusText} (${response.status})`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to connect to GitHub API: ${error}`);
  }
}

/**
 * Validate CLI flags for fix command
 */
export function validateFixFlags(options: any): ValidationResult {
  const errors: string[] = [];

  // Validate run IDs format if provided
  if (options.runIds) {
    const ids = options.runIds.split(',').map((id: string) => id.trim());
    for (const id of ids) {
      const num = parseInt(id, 10);
      if (isNaN(num)) {
        errors.push(`Invalid run ID: "${id}" must be a number`);
      }
    }
  }

  // Validate log level
  if (options.logLevel && !['debug', 'info', 'warn', 'error'].includes(options.logLevel)) {
    errors.push(`Invalid log level: "${options.logLevel}". Must be one of: debug, info, warn, error`);
  }

  // Validate format
  if (options.format && !['pretty', 'json', 'plain'].includes(options.format)) {
    errors.push(`Invalid format: "${options.format}". Must be one of: pretty, json, plain`);
  }

  // Validate backend
  if (options.backend && !['e2b', 'docker_local', 'kubernetes'].includes(options.backend)) {
    errors.push(`Invalid backend: "${options.backend}". Must be one of: e2b, docker_local, kubernetes`);
  }

  // Validate dev env
  if (options.devEnv && !['simulation', 'e2b', 'github_actions'].includes(options.devEnv)) {
    errors.push(`Invalid dev env: "${options.devEnv}". Must be one of: simulation, e2b, github_actions`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
