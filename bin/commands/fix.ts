import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../../cli/config.js';
import { resolveConfig } from '../../shared/config-resolver.js';
import { validateConfig, validateFixFlags, testGitHubAuth } from '../../cli/validation.js';
import { runAgentFromCLI } from '../../shared/agent-runner.js';
import { createCLILogger } from '../../cli/logger.js';
import { formatAgentSummary, formatFilesChanges, formatError } from '../../cli/output.js';

export const fixCommand = new Command('fix')
  .description('Fix CI/CD failures for a repository')
  .option('--repo <owner/repo>', 'Repository URL (e.g., facebook/react)')
  .option('--pr <number>', 'Pull request number')
  .option('--run-ids <ids>', 'Comma-separated workflow run IDs')
  .option('--exclude <patterns>', 'Comma-separated workflow patterns to exclude')
  .option('--config <path>', 'Path to config file', '.ci-fixer.yaml')
  .option('--llm <provider>', 'LLM provider (google, zai, openai)')
  .option('--model <name>', 'LLM model name')
  .option('--dev-env <env>', 'Dev environment (simulation, e2b, github_actions)')
  .option('--check-env <env>', 'Check environment (simulation, github_actions, e2b)')
  .option('--backend <backend>', 'Execution backend (e2b, docker_local, kubernetes)')
  .option('--log-level <level>', 'Log level (debug, info, warn, error)', 'info')
  .option('--format <format>', 'Output format (pretty, json, plain)', 'pretty')
  .option('--dry-run', 'Validate inputs without running agent', false)
  .action(async (options) => {
    try {
      // 1. Validate CLI flags
      const flagValidation = validateFixFlags(options);
      if (!flagValidation.valid) {
        console.error(chalk.red('Invalid flags:'));
        for (const error of flagValidation.errors) {
          console.error(chalk.red(`  - ${error}`));
        }
        process.exit(2);
      }

      // 2. Load config from file
      const fileConfig = await loadConfig(options.config);

      // 3. Resolve config (file + env + CLI flags)
      const config = resolveConfig(fileConfig, options);

      // 4. Validate configuration
      const configValidation = await validateConfig(config);
      if (!configValidation.valid) {
        console.error(chalk.red('Configuration errors:'));
        for (const error of configValidation.errors) {
          console.error(chalk.red(`  - ${error}`));
        }
        process.exit(3);
      }

      // 5. Create CLI logger
      const logger = createCLILogger({
        level: config.logLevel,
        format: options.format
      });

      // 6. Test GitHub authentication
      logger.start('Testing GitHub authentication...');
      try {
        await testGitHubAuth(config.githubToken, config.repoUrl);
        logger.stop(chalk.green('GitHub authentication successful'));
      } catch (error) {
        logger.stop();
        logger.error((error as Error).message);
        process.exit(3);
      }

      // 7. Run agent
      try {
        const finalState = await runAgentFromCLI(config, logger, {
          dryRun: options.dryRun
        });

        // 8. Display results
        if (!options.dryRun && finalState.status === 'success') {
          console.log('\n' + chalk.green.bold('✓ Fix completed successfully!'));
          console.log('\n' + formatAgentSummary(finalState));

          if (Object.keys(finalState.files || {}).length > 0) {
            console.log('\n' + chalk.cyan.bold('Files Changed:'));
            console.log(formatFilesChanges(finalState.files));
          }
        } else if (finalState.status === 'failed') {
          console.log('\n' + formatError(new Error('Fix failed')));
          console.log('\n' + formatAgentSummary(finalState));
          process.exit(1);
        }

        process.exit(0);
      } catch (error) {
        logger.error((error as Error).message);
        if (config.logLevel === 'debug') {
          console.error((error as Error).stack);
        }
        process.exit(1);
      }

    } catch (error) {
      console.error(formatError(error as Error));
      process.exit(1);
    }
  });
