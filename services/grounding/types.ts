import { z } from 'zod';

export const GroundingAction = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
  CHECK: 'check'
} as const;

export type GroundingActionType = typeof GroundingAction[keyof typeof GroundingAction];

export const GroundingRequestSchema = z.object({
  path: z.string(),
  action: z.string(), // Allowing string to accommodate broader actions, but typically GroundingAction
  context: z.any().optional()
});

export type GroundingRequest = z.infer<typeof GroundingRequestSchema>;

export const GroundingResultSchema = z.object({
  originalPath: z.string(),
  groundedPath: z.string().nullable(),
  success: z.boolean(),
  confidence: z.number().min(0).max(1),
  error: z.string().optional(),
  action: z.string().optional()
});

export type GroundingResult = z.infer<typeof GroundingResultSchema>;