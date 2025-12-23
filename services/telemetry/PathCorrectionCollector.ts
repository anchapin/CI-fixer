/**
 * Path Correction Telemetry Collector
 *
 * Parses [PATH_CORRECTION] logs from sandbox output and stores them in the database.
 * This runs on the host system to collect telemetry from sandbox executions.
 */

import { recordPathCorrection } from './PathCorrectionService.js';
import { log } from '../../utils/logger.js';

export interface PathCorrectionLog {
  tool: string;
  originalPath: string;
  correctedPath: string;
  filename: string;
  timestamp: string;
}

/**
 * Extracts path correction logs from sandbox output.
 * Looks for [PATH_CORRECTION] JSON objects in the output.
 */
export function extractPathCorrections(output: string): PathCorrectionLog[] {
  const corrections: PathCorrectionLog[] = [];
  const pattern = /\[PATH_CORRECTION\] (\{[^}]+\})/g;
  let match;

  while ((match = pattern.exec(output)) !== null) {
    try {
      const correction = JSON.parse(match[1]) as PathCorrectionLog;
      corrections.push(correction);
    } catch (e) {
      log('WARN', `[PathCorrection] Failed to parse correction log: ${(e as Error).message}`);
    }
  }

  return corrections;
}

/**
 * Processes sandbox output and records any path corrections to the database.
 */
export async function collectPathCorrections(
  output: string,
  agentRunId?: string
): Promise<number> {
  const corrections = extractPathCorrections(output);

  for (const correction of corrections) {
    await recordPathCorrection({
      originalPath: correction.originalPath,
      correctedPath: correction.correctedPath,
      filename: correction.filename,
      toolName: correction.tool,
      agentRunId,
    });
  }

  return corrections.length;
}
