import { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';

export const uiCommand = new Command('ui')
  .description('Launch the web interface')
  .option('--port <number>', 'Port for web UI', '3000')
  .option('--backend-only', 'Start only backend server', false)
  .action(async (options) => {
    console.log(chalk.cyan('Starting CI-Fixer web interface...\n'));

    let command: string;
    let args: string[];

    if (options.backendOnly) {
      console.log(chalk.yellow('Backend-only mode'));
      console.log(chalk.gray('Server will run on port 3001\n'));
      command = 'npm';
      args = ['run', 'server'];
    } else {
      console.log(chalk.gray('Frontend: http://localhost:' + options.port));
      console.log(chalk.gray('Backend:  http://localhost:3001\n'));
      console.log(chalk.cyan('Press Ctrl+C to stop\n'));
      command = 'npm';
      args = ['run', 'dev'];
    }

    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, PORT: options.port }
    });

    child.on('error', (error) => {
      console.error(chalk.red(`Failed to start: ${error.message}`));
      process.exit(1);
    });

    child.on('exit', (code) => {
      console.log(chalk.cyan(`\nWeb UI exited with code ${code || 0}`));
      process.exit(code || 0);
    });

    // Forward signals to child process
    process.on('SIGINT', () => {
      child.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
      child.kill('SIGTERM');
    });
  });
