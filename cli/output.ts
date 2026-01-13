import Table from 'cli-table3';
import chalk from 'chalk';
import { AgentState, FileChange } from '../types.js';

export function formatAgentSummary(state: AgentState): string {
  const table = new Table({
    head: [chalk.cyan('Metric'), chalk.cyan('Value')],
    colWidths: [25, 60],
    style: {
      head: [],
      border: ['gray']
    }
  });

  table.push(
    ['Status', formatStatus(state.status)],
    ['Phase', state.phase],
    ['Iterations', state.iteration.toString()],
    ['Files Changed', Object.keys(state.files || {}).length.toString()],
    ['Total Cost', state.totalCost ? `$${state.totalCost.toFixed(4)}` : 'N/A'],
    ['Total Latency', state.totalLatency ? `${(state.totalLatency / 1000).toFixed(2)}s` : 'N/A']
  );

  if (state.message) {
    table.push(['Message', state.message]);
  }

  return table.toString();
}

export function formatFilesChanges(files: Record<string, FileChange>): string {
  const entries = Object.entries(files);

  if (entries.length === 0) {
    return chalk.yellow('No files changed');
  }

  const table = new Table({
    head: [chalk.cyan('File'), chalk.cyan('Operation'), chalk.cyan('Lines')],
    colWidths: [50, 15, 15],
    style: {
      head: [],
      border: ['gray']
    }
  });

  for (const [path, change] of entries) {
    const op = change.operation || 'modify';
    const lines = change.diff ? change.diff.split('\n').length.toString() : 'N/A';
    table.push([path, formatOperation(op), lines]);
  }

  return table.toString();
}

export function formatJSON(data: any): string {
  return JSON.stringify(data, null, 2);
}

export function formatError(error: Error): string {
  return chalk.red(`Error: ${error.message}`);
}

function formatStatus(status: string): string {
  switch (status) {
    case 'success':
      return chalk.green('✓ Success');
    case 'failed':
      return chalk.red('✗ Failed');
    case 'working':
      return chalk.yellow('⟳ Working');
    case 'waiting':
      return chalk.blue('⋯ Waiting');
    case 'idle':
      return chalk.gray('○ Idle');
    default:
      return status;
  }
}

function formatOperation(op: string): string {
  switch (op) {
    case 'create':
      return chalk.green('+ Create');
    case 'delete':
      return chalk.red('- Delete');
    case 'modify':
      return chalk.yellow('~ Modify');
    default:
      return op;
  }
}

export function formatProgress(current: number, total: number, message: string): string {
  const percentage = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(percentage / 2)) + '░'.repeat(50 - Math.floor(percentage / 2));
  return `${chalk.cyan('[')}${bar}${chalk.cyan(']')} ${percentage}% ${message}`;
}
