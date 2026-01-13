import { AppConfig } from '../types.js';
import { ConfigFile } from '../cli/config.js';

export interface CLIOptions {
  repo?: string;
  pr?: string;
  runIds?: string;
  exclude?: string;
  llm?: string;
  model?: string;
  devEnv?: string;
  checkEnv?: string;
  backend?: string;
  logLevel?: string;
  format?: string;
  dryRun?: boolean;
}

/**
 * Resolve configuration from multiple sources
 * Priority: CLI flags > env vars > config file > defaults
 */
export function resolveConfig(
  fileConfig: ConfigFile,
  cliOptions: CLIOptions
): AppConfig {
  // GitHub
  const githubToken = cliOptions.repo ? '' : // If --repo provided, don't use file token (might be different repo)
    process.env.GITHUB_TOKEN ||
    fileConfig.github?.token ||
    '';

  const repoUrl = cliOptions.repo ||
    process.env.REPO_URL ||
    fileConfig.repo?.url ||
    '';

  const prUrl = cliOptions.pr ?
    `https://github.com/${repoUrl}/pull/${cliOptions.pr}` :
    fileConfig.repo?.pr ?
    `https://github.com/${repoUrl}/pull/${fileConfig.repo.pr}` :
    undefined;

  // Workflows
  const excludePatterns = cliOptions.exclude ?
    cliOptions.exclude.split(',') :
    fileConfig.workflows?.exclude ||
    [];

  // LLM
  const llmProvider = cliOptions.llm ||
    process.env.LLM_PROVIDER as any ||
    fileConfig.llm?.provider as any ||
    'google';

  const llmModel = cliOptions.model ||
    process.env.LLM_MODEL ||
    fileConfig.llm?.model ||
    'gemini-2.5-flash-preview-04-17';

  const llmBaseUrl = fileConfig.llm?.base_url;

  const customApiKey = process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    fileConfig.api_keys?.gemini ||
    fileConfig.api_keys?.openai ||
    '';

  const tavilyApiKey = process.env.TAVILY_API_KEY ||
    fileConfig.api_keys?.tavily;

  const e2bApiKey = process.env.E2B_API_KEY ||
    fileConfig.api_keys?.e2b;

  // Execution
  const devEnv = (cliOptions.devEnv || fileConfig.execution?.dev_env || 'e2b') as any;
  const checkEnv = (cliOptions.checkEnv || fileConfig.execution?.check_env || 'github_actions') as any;
  const executionBackend = (cliOptions.backend || fileConfig.execution?.backend || 'e2b') as any;
  const dockerImage = fileConfig.execution?.docker_image;
  const sandboxTimeoutMinutes = fileConfig.execution?.sandbox_timeout || 30;

  // Logging
  const logLevel = (cliOptions.logLevel || fileConfig.logging?.level || 'info') as any;

  // Reliability
  const adaptiveThresholds = fileConfig.reliability?.adaptive_thresholds !== false;
  const phase2ReproductionThreshold = fileConfig.reliability?.phase2_reproduction_threshold || 1;
  const phase3ComplexityThreshold = fileConfig.reliability?.phase3_complexity_threshold || 15;
  const phase3IterationThreshold = fileConfig.reliability?.phase3_iteration_threshold || 2;

  return {
    githubToken,
    repoUrl,
    prUrl,
    excludeWorkflowPatterns: excludePatterns,
    llmProvider,
    llmModel,
    llmBaseUrl,
    customApiKey,
    tavilyApiKey,
    e2bApiKey,
    devEnv,
    checkEnv,
    executionBackend,
    dockerImage,
    sandboxTimeoutMinutes,
    logLevel,
    adaptiveThresholds,
    phase2ReproductionThreshold,
    phase3ComplexityThreshold,
    phase3IterationThreshold,
    selectedRuns: [], // Will be populated by agent-runner
    searchProvider: 'tavily' // Default
  };
}
