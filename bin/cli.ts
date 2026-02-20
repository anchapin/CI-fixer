#!/usr/bin/env node
import { Command } from 'commander';
import { fixCommand } from './commands/fix.js';
import { uiCommand } from './commands/ui.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('ci-fixer')
  .description('Autonomous CI/CD failure fixing agent')
  .version('1.0.0');

// Register subcommands
program.addCommand(fixCommand);
program.addCommand(uiCommand);
program.addCommand(configCommand);

// Parse and execute
program.parseAsync(process.argv)
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
