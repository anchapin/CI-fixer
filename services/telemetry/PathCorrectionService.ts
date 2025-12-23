/**
 * Path Correction Telemetry Service
 *
 * Tracks when the agent's file path verification automatically corrects
 * a hallucinated path to the actual file path.
 */

import { db as prisma } from '../../db/client.js';
import { log } from '../../utils/logger.js';

export interface PathCorrectionEvent {
  originalPath: string;
  correctedPath: string;
  filename: string;
  toolName: string;
  agentRunId?: string;
}

/**
 * Records when a path is automatically corrected by the verification system.
 * This helps track how often the agent hallucinates paths and how well
 * the auto-correction system works.
 */
export async function recordPathCorrection(event: PathCorrectionEvent): Promise<void> {
  try {
    await prisma.pathCorrection.create({
      data: {
        originalPath: event.originalPath,
        correctedPath: event.correctedPath,
        filename: event.filename,
        toolName: event.toolName,
        agentRunId: event.agentRunId,
      },
    });

    log(
      'INFO',
      `[PathCorrection] ${event.toolName}: "${event.originalPath}" -> "${event.correctedPath}"`
    );
  } catch (error) {
    // Don't fail the operation if telemetry fails
    log('WARN', `[PathCorrection] Failed to record correction: ${(error as Error).message}`);
  }
}

/**
 * Gets statistics about path corrections for a given time period.
 */
export async function getPathCorrectionStats(since?: Date): Promise<{
  totalCorrections: number;
  byTool: Record<string, number>;
  byFile: Record<string, number>;
}> {
  const where = since ? { createdAt: { gte: since } } : {};

  const corrections = await prisma.pathCorrection.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const byTool: Record<string, number> = {};
  const byFile: Record<string, number> = {};

  for (const correction of corrections) {
    byTool[correction.toolName] = (byTool[correction.toolName] || 0) + 1;
    byFile[correction.filename] = (byFile[correction.filename] || 0) + 1;
  }

  return {
    totalCorrections: corrections.length,
    byTool,
    byFile,
  };
}

/**
 * Gets recent path corrections for debugging.
 */
export async function getRecentPathCorrections(limit: number = 50): Promise<PathCorrectionEvent[]> {
  const corrections = await prisma.pathCorrection.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return corrections.map((c) => ({
    originalPath: c.originalPath,
    correctedPath: c.correctedPath,
    filename: c.filename,
    toolName: c.toolName,
    agentRunId: c.agentRunId || undefined,
  }));
}
