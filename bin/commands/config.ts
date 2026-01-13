import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile } from 'fs/promises';
import { getExampleConfig } from '../../cli/config.js';

export const configCommand = new Command('config')
  .description('Manage configuration');

configCommand
  .command('init')
  .description('Create .ci-fixer.yaml config file')
  .option('-f, --force', 'Overwrite existing config file', false)
  .action(async (options) => {
    const configFile = '.ci-fixer.yaml';

    if (!options.force) {
      try {
        const { existsSync } = await import('fs');
        if (existsSync(configFile)) {
          console.error(chalk.red(`Config file ${configFile} already exists`));
          console.log(chalk.gray('Use --force to overwrite'));
          process.exit(1);
        }
      } catch {}
    }

    try {
      await writeFile(configFile, getExampleConfig());
      console.log(chalk.green(`✓ Created ${configFile}`));
      console.log(chalk.gray('\nEdit the file to configure your settings'));
      console.log(chalk.gray('See .ci-fixer.example.yaml for reference\n'));
    } catch (error) {
      console.error(chalk.red(`Failed to create config file: ${(error as Error).message}`));
      process.exit(1);
    }
  });

configCommand
  .command('validate')
  .description('Validate configuration file')
  .option('--config <path>', 'Path to config file', '.ci-fixer.yaml')
  .action(async (options) => {
    const { loadConfig } = await import('../../cli/config.js');
    const { validateConfig } = await import('../../cli/validation.js');
    const { resolveConfig } = await import('../../shared/config-resolver.js');

    try {
      console.log(chalk.cyan(`Validating ${options.config}...\n`));

      const fileConfig = await loadConfig(options.config);
      const config = resolveConfig(fileConfig, {});

      const validation = await validateConfig(config);

      if (validation.valid) {
        console.log(chalk.green('✓ Configuration is valid\n'));
        console.log(chalk.gray('Configuration loaded:'));
        console.log(chalk.gray(`  Repo: ${config.repoUrl || 'not set'}`));
        console.log(chalk.gray(`  LLM: ${config.llmProvider}/${config.llmModel}`));
        console.log(chalk.gray(`  Backend: ${config.executionBackend}`));
        console.log(chalk.gray(`  Log Level: ${config.logLevel}\n`));
      } else {
        console.log(chalk.red('✗ Configuration errors:\n'));
        for (const error of validation.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
        console.log();
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}\n`));
      process.exit(1);
    }
  });
