/**
 * RecoveryStrategyService Service
 *
 * Orchestrates automatic recovery strategies when reliability layers are triggered.
 * Uses telemetry data to select the most effective recovery strategies.
 *
 * Phase 3 Enhancement: Recovery Strategies
 */

import { PrismaClient } from '@prisma/client';
import { ReproductionInferenceService } from '../reproduction-inference.js';
import { ReliabilityTelemetry } from './ReliabilityTelemetry.js';
import { ReliabilityMetrics } from './ReliabilityMetrics.js';

export interface RecoveryContext {
    agentRunId: string;
    layer: 'phase2-reproduction' | 'phase3-loop-detection';
    threshold: number;
    // Phase 2 context
    reproductionCommand?: string;
    errorSummary?: string;
    // Phase 3 context
    complexity?: number;
    complexityHistory?: number[];
    iteration?: number;
    divergingCount?: number;
    // Shared context
    repoPath?: string;
    config?: any; // AppConfig
    sandbox?: any; // SandboxEnvironment
}

export interface RecoveryResult {
    success: boolean;
    strategy: string;
    newValue?: any; // The recovered value (e.g., reproduction command)
    reasoning: string;
    confidence: number;
    attemptNumber: number;
}

export interface RecoveryStrategy {
    name: string;
    description: string;
    canAttempt: (context: RecoveryContext) => boolean;
    attempt: (context: RecoveryContext) => Promise<RecoveryResult>;
}

/**
 * RecoveryStrategyService orchestrates recovery attempts for reliability layer triggers.
 */
export class RecoveryStrategyService {
    private prisma: PrismaClient;
    private telemetry: ReliabilityTelemetry;
    private metrics: ReliabilityMetrics;
    private reproductionInference: ReproductionInferenceService;

    // Strategy registry
    private phase2Strategies: RecoveryStrategy[] = [];
    private phase3Strategies: RecoveryStrategy[] = [];

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.telemetry = new ReliabilityTelemetry(prisma);
        this.metrics = new ReliabilityMetrics(prisma);
        this.reproductionInference = new ReproductionInferenceService();

        this.initializeStrategies();
    }

    /**
     * Initialize recovery strategies for both phases
     */
    private initializeStrategies(): void {
        // Phase 2: Reproduction-First recovery strategies
        this.phase2Strategies = [
            {
                name: 'infer-command',
                description: 'Infer reproduction command from workflow, build tools, or repository structure',
                canAttempt: (ctx) => !ctx.reproductionCommand && !!ctx.repoPath,
                attempt: async (ctx) => this.attemptReproductionInference(ctx)
            },
            {
                name: 'request-human',
                description: 'Request human intervention for reproduction command',
                canAttempt: () => true, // Always available as fallback
                attempt: async (ctx) => this.attemptHumanIntervention(ctx)
            }
        ];

        // Phase 3: Strategy Loop recovery strategies
        this.phase3Strategies = [
            {
                name: 'reduce-scope',
                description: 'Reduce problem scope by breaking down into smaller sub-problems',
                canAttempt: (ctx) => ctx.complexity !== undefined && ctx.complexity > 15,
                attempt: async (ctx) => this.attemptReduceScope(ctx)
            },
            {
                name: 'switch-mode',
                description: 'Switch to alternative execution mode (e.g., simulation to e2b)',
                canAttempt: () => true, // Always available
                attempt: async (ctx) => this.attemptSwitchMode(ctx)
            },
            {
                name: 'regenerate',
                description: 'Regenerate solution with fresh perspective',
                canAttempt: (ctx) => ctx.iteration !== undefined && ctx.iteration < 5,
                attempt: async (ctx) => this.attemptRegenerate(ctx)
            },
            {
                name: 'request-human',
                description: 'Request human intervention for strategy loop',
                canAttempt: () => true, // Always available as fallback
                attempt: async (ctx) => this.attemptHumanIntervention(ctx)
            }
        ];
    }

    /**
     * Attempt to recover from a reliability layer trigger.
     * Returns the recovery result or null if no strategies could be attempted.
     */
    async attemptRecovery(
        context: RecoveryContext,
        telemetryEventId: string
    ): Promise<RecoveryResult | null> {
        const strategies = context.layer === 'phase2-reproduction'
            ? this.phase2Strategies
            : this.phase3Strategies;

        // Get historical success rates for strategies
        const topStrategies = await this.metrics.getTopStrategies(context.layer, 10);
        const strategySuccessRates = new Map<string, number>();
        for (const s of topStrategies) {
            strategySuccessRates.set(s.strategy, s.successRate);
        }

        // Try strategies in order of historical success, then fallback
        let attemptNumber = 0;
        for (const strategy of strategies) {
            if (!strategy.canAttempt(context)) {
                continue;
            }

            attemptNumber++;
            const result = await strategy.attempt(context);
            result.attemptNumber = attemptNumber;

            // Record recovery attempt (only if we have a valid event ID)
            if (telemetryEventId) {
                try {
                    await this.telemetry.updateRecoveryOutcome(
                        telemetryEventId,
                        strategy.name,
                        result.success
                    );
                } catch (error) {
                    // Don't let telemetry errors prevent recovery attempts
                    console.warn(`Failed to record recovery outcome: ${error}`);
                }
            }

            if (result.success) {
                return result;
            }

            // If strategy failed, try next one
        }

        return null;
    }

    /**
     * Phase 2 Strategy: Attempt to infer reproduction command
     */
    private async attemptReproductionInference(context: RecoveryContext): Promise<RecoveryResult> {
        try {
            if (!context.repoPath) {
                return {
                    success: false,
                    strategy: 'infer-command',
                    reasoning: 'Repository path not provided',
                    confidence: 0,
                    attemptNumber: 0
                };
            }

            const result = await this.reproductionInference.inferCommand(
                context.repoPath,
                context.config,
                context.sandbox,
                {
                    workflowPath: undefined, // Could be extracted from context
                    logText: context.errorSummary || ''
                }
            );

            if (result && result.command) {
                return {
                    success: true,
                    strategy: 'infer-command',
                    newValue: result.command,
                    reasoning: result.reasoning,
                    confidence: result.confidence,
                    attemptNumber: 0
                };
            }

            return {
                success: false,
                strategy: 'infer-command',
                reasoning: 'Could not infer reproduction command',
                confidence: 0,
                attemptNumber: 0
            };
        } catch (error) {
            return {
                success: false,
                strategy: 'infer-command',
                reasoning: `Inference failed: ${error instanceof Error ? error.message : String(error)}`,
                confidence: 0,
                attemptNumber: 0
            };
        }
    }

    /**
     * Phase 3 Strategy: Reduce problem scope
     */
    private async attemptReduceScope(context: RecoveryContext): Promise<RecoveryResult> {
        // This strategy provides guidance to the agent
        // The actual scope reduction would be implemented in the agent's planning node
        return {
            success: true,
            strategy: 'reduce-scope',
            newValue: {
                guidance: 'Break down the problem into smaller, atomic sub-problems',
                suggestedActions: [
                    'Identify the root error in the chain',
                    'Focus on fixing the root error first',
                    'Ignore cascading errors until root is fixed',
                    'Use dependency ordering to solve sub-problems sequentially'
                ]
            },
            reasoning: `Complexity ${context.complexity} exceeds threshold. Suggesting scope reduction.`,
            confidence: 0.8,
            attemptNumber: 0
        };
    }

    /**
     * Phase 3 Strategy: Switch execution mode
     */
    private async attemptSwitchMode(context: RecoveryContext): Promise<RecoveryResult> {
        // This strategy suggests switching execution environments
        return {
            success: true,
            strategy: 'switch-mode',
            newValue: {
                guidance: 'Switch to alternative execution environment',
                suggestedModes: [
                    'If using simulation, try e2b or docker_local',
                    'If using e2b, try docker_local',
                    'Ensure environment isolation is working correctly'
                ]
            },
            reasoning: 'Current execution mode may be causing issues. Suggesting mode switch.',
            confidence: 0.6,
            attemptNumber: 0
        };
    }

    /**
     * Phase 3 Strategy: Regenerate solution
     */
    private async attemptRegenerate(context: RecoveryContext): Promise<RecoveryResult> {
        // This strategy suggests regenerating with fresh perspective
        return {
            success: true,
            strategy: 'regenerate',
            newValue: {
                guidance: 'Regenerate solution with alternative approach',
                suggestedActions: [
                    'Review the problem from a different angle',
                    'Consider alternative fix strategies',
                    'Try different tools or methods',
                    'Avoid repeating the same approach'
                ]
            },
            reasoning: `Iteration ${context.iteration} suggests stuck approach. Suggesting regeneration.`,
            confidence: 0.7,
            attemptNumber: 0
        };
    }

    /**
     * Fallback Strategy: Request human intervention
     */
    private async attemptHumanIntervention(context: RecoveryContext): Promise<RecoveryResult> {
        const message = context.layer === 'phase2-reproduction'
            ? 'Human intervention required: Please provide reproduction command'
            : 'Human intervention required: Agent stuck in strategy loop';

        return {
            success: false, // Human intervention means automatic recovery failed
            strategy: 'request-human',
            newValue: {
                requiresHumanIntervention: true,
                message,
                context
            },
            reasoning: 'Automatic recovery strategies exhausted. Human intervention required.',
            confidence: 1.0,
            attemptNumber: 0
        };
    }

    /**
     * Get available strategies for a layer
     */
    getAvailableStrategies(layer: 'phase2-reproduction' | 'phase3-loop-detection'): RecoveryStrategy[] {
        return layer === 'phase2-reproduction'
            ? this.phase2Strategies
            : this.phase3Strategies;
    }

    /**
     * Get strategy statistics for dashboard
     */
    async getStrategyStats(
        layer: 'phase2-reproduction' | 'phase3-loop-detection'
    ): Promise<{
        availableStrategies: string[];
        topStrategies: Array<{ strategy: string; successRate: number; attempts: number }>;
    }> {
        const availableStrategies = this.getAvailableStrategies(layer).map(s => s.name);
        const topStrategies = await this.metrics.getTopStrategies(layer, 10);

        return {
            availableStrategies,
            topStrategies
        };
    }
}

// Singleton instance for dependency injection
let recoveryStrategyInstance: RecoveryStrategyService | null = null;

export function getRecoveryStrategyService(prisma: PrismaClient): RecoveryStrategyService {
    if (!recoveryStrategyInstance) {
        recoveryStrategyInstance = new RecoveryStrategyService(prisma);
    }
    return recoveryStrategyInstance;
}
