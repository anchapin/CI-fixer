import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { existsSync } from 'fs';

export interface ConfigFile {
  github?: {
    token?: string;
  };
  repo?: {
    url?: string;
    pr?: number;
  };
  workflows?: {
    exclude?: string[];
    run_ids?: number[];
  };
  llm?: {
    provider?: string;
    model?: string;
    base_url?: string;
    timeout?: number;
  };
  api_keys?: {
    gemini?: string;
    tavily?: string;
    e2b?: string;
    openai?: string;
  };
  execution?: {
    dev_env?: 'simulation' | 'e2b' | 'github_actions';
    check_env?: 'simulation' | 'github_actions' | 'e2b';
    backend?: 'e2b' | 'docker_local' | 'kubernetes';
    sandbox_timeout?: number;
    docker_image?: string;
  };
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    format?: 'pretty' | 'json' | 'plain';
  };
  reliability?: {
    adaptive_thresholds?: boolean;
    phase2_reproduction_threshold?: number;
    phase3_complexity_threshold?: number;
    phase3_iteration_threshold?: number;
  };
}

/**
 * Load configuration from YAML file
 */
export async function loadConfig(filePath: string = '.ci-fixer.yaml'): Promise<ConfigFile> {
  if (!existsSync(filePath)) {
    // Return empty config if file doesn't exist
    return {};
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const config = parse(content) as ConfigFile;

    // Interpolate environment variables
    return interpolateEnvVars(config);
  } catch (error) {
    throw new Error(`Failed to load config from ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Interpolate environment variables in config values
 * Supports: ${VAR_NAME} syntax
 */
function interpolateEnvVars(config: any): any {
  if (typeof config === 'string') {
    // Replace ${VAR_NAME} with process.env.VAR_NAME
    return config.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }

  if (Array.isArray(config)) {
    return config.map(item => interpolateEnvVars(item));
  }

  if (config && typeof config === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(config)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }

  return config;
}

/**
 * Get example configuration as string
 */
export function getExampleConfig(): string {
  return `# CI-Fixer Configuration File
# Copy this file to .ci-fixer.yaml and customize for your environment

# GitHub Configuration
github:
  # GitHub personal access token (can use environment variable)
  # Create at: https://github.com/settings/tokens
  # Required scopes: repo, workflow
  token: \${GITHUB_TOKEN}

# Repository Configuration
repo:
  # Default repository URL (format: owner/repo)
  # Can be overridden with --repo CLI flag
  url: owner/repo

# LLM Configuration
llm:
  # LLM provider: google, zai, openai
  provider: google

  # Model name
  model: gemini-2.5-flash-preview-04-17

# API Keys
api_keys:
  # Google Gemini API key
  gemini: \${GEMINI_API_KEY}

  # Optional: Tavily API key for web search
  tavily: \${TAVILY_API_KEY}

  # Optional: E2B API key for cloud sandbox
  e2b: \${E2B_API_KEY}

# Execution Environment
execution:
  # Development environment: simulation, e2b, github_actions
  dev_env: e2b

  # Check environment: simulation, github_actions, e2b
  check_env: github_actions

  # Execution backend: e2b, docker_local, kubernetes
  backend: e2b

  # Sandbox timeout in minutes
  sandbox_timeout: 30

# Logging
logging:
  # Log level: debug, info, warn, error
  level: info

  # Output format: pretty, json, plain
  format: pretty
`;
}
