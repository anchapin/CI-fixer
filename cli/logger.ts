import ora, { Ora } from 'ora';
import chalk from 'chalk';
import { LogLine } from '../types.js';

export interface CLILoggerOptions {
  level: LogLine['level'];
  format: 'pretty' | 'json' | 'plain';
}

export class CLILogger {
  private spinner: Ora | null = null;
  private level: LogLine['level'];
  private format: 'pretty' | 'json' | 'plain';

  constructor(options: CLILoggerOptions) {
    this.level = options.level;
    this.format = options.format;
  }

  onLog(level: LogLine['level'], content: string, source?: string): void {
    if (this.shouldLog(level)) {
      const prefix = source ? `[${source}] ` : '';

      if (this.format === 'json') {
        console.log(JSON.stringify({
          level,
          source: source || 'CLI',
          content,
          timestamp: Date.now()
        }));
      } else if (this.format === 'plain') {
        console.log(`${prefix}${content}`);
      } else {
        // Pretty: color-coded
        const colored = this.colorize(level, `${prefix}${content}`);
        console.log(colored);
      }
    }
  }

  onStateUpdate(phase: string, message?: string): void {
    const text = message ? `${phase}: ${message}` : phase;

    if (this.format === 'json') {
      console.log(JSON.stringify({
        type: 'state_update',
        phase,
        message,
        timestamp: Date.now()
      }));
    } else if (this.format === 'plain') {
      console.log(`[${phase}] ${message || ''}`);
    } else {
      // Pretty format with spinner
      if (phase === 'SUCCESS' || phase === 'COMPLETED') {
        this.spinner?.succeed(chalk.green(message || 'Completed successfully!'));
        this.spinner = null;
      } else if (phase === 'FAILURE' || phase === 'FAILED' || phase === 'ERROR') {
        this.spinner?.fail(chalk.red(message || 'Failed'));
        this.spinner = null;
      } else if (this.spinner) {
        this.spinner.text = text;
      } else {
        this.spinner = ora(text).start();
      }
    }
  }

  info(msg: string): void {
    this.onLog('INFO', msg, 'CI-Fixer');
  }

  warn(msg: string): void {
    this.onLog('WARN', msg, 'CI-Fixer');
  }

  error(msg: string): void {
    this.onLog('ERROR', msg, 'CI-Fixer');
  }

  debug(msg: string): void {
    this.onLog('DEBUG', msg, 'CI-Fixer');
  }

  success(msg: string): void {
    this.onLog('SUCCESS', msg, 'CI-Fixer');
  }

  start(message: string): void {
    if (this.format === 'pretty') {
      this.spinner = ora(message).start();
    } else {
      this.info(message);
    }
  }

  stop(message?: string): void {
    if (this.spinner) {
      if (message) {
        this.spinner.succeed(chalk.green(message));
      } else {
        this.spinner.stop();
      }
      this.spinner = null;
    }
  }

  private colorize(level: string, text: string): string {
    switch (level) {
      case 'ERROR':
        return chalk.red(text);
      case 'WARN':
        return chalk.yellow(text);
      case 'SUCCESS':
        return chalk.green(text);
      case 'DEBUG':
        return chalk.gray(text);
      case 'INFO':
      default:
        return chalk.white(text);
    }
  }

  private shouldLog(level: LogLine['level']): boolean {
    const levels: LogLine['level'][] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SUCCESS'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }
}

export function createCLILogger(options: CLILoggerOptions): CLILogger {
  return new CLILogger(options);
}
