/**
 * RepairAgent Graph Node
 * Integrates RepairAgent into the graph architecture as an optional execution mode
 */

import { GraphState, GraphContext, NodeHandler } from '../state.js';
import { withNodeTracing } from './tracing-wrapper.js';

const repairAgentNodeHandler: NodeHandler = async (state, context) => {
    const { config, group, diagnosis, currentLogText, iteration } = state;
    const { logCallback, sandbox, services } = context;
    const log = (level: string, msg: string) => logCallback(level as any, msg);

    if (!diagnosis) {
        return { status: 'failed', failureReason: 'No diagnosis available for RepairAgent' };
    }

    if (!sandbox) {
        log('WARN', '[RepairAgent] No sandbox available, falling back to standard execution');
        return { currentNode: 'execution' };
    }

    log('INFO', '[RepairAgent] Starting autonomous repair process...');

    // Get file content (simplified - in real implementation would fetch from sandbox)
    const originalCode = state.files[diagnosis.filePath || '']?.original?.content || '';

    // Determine test command
    const testCommand = diagnosis.reproductionCommand ||
        group.mainRun.reproduction_command ||
        'npm test';

    // Run RepairAgent
    const agentConfig = services.repairAgent.getRepairAgentConfig();
    const result = await services.repairAgent.runRepairAgent(
        config,
        currentLogText,
        originalCode,
        diagnosis.summary,
        sandbox,
        testCommand,
        state.initialRepoContext,
        agentConfig
    );

    // Log results
    log('INFO', `[RepairAgent] Completed in ${result.executionTime}ms`);
    log('INFO', `[RepairAgent] Success: ${result.success}`);
    if (result.faultLocalization) {
        log('VERBOSE', `[RepairAgent] Fault localized to ${result.faultLocalization.primaryLocation.file}:${result.faultLocalization.primaryLocation.line}`);
    }
    if (result.patchGeneration) {
        log('VERBOSE', `[RepairAgent] Generated ${result.patchGeneration.candidates.length} patch candidates`);
    }
    if (result.iterations > 0) {
        log('VERBOSE', `[RepairAgent] Refined patch over ${result.iterations} iterations`);
    }

    // Update state with final patch
    if (result.success && diagnosis.filePath) {
        const newFiles = { ...state.files };
        newFiles[diagnosis.filePath] = {
            path: diagnosis.filePath,
            original: { name: diagnosis.filePath, content: originalCode, language: 'text' },
            modified: { name: diagnosis.filePath, content: result.finalPatch, language: 'text' },
            status: 'modified'
        };

        return {
            files: newFiles,
            currentNode: 'verification',
            iteration: iteration + 1
        };
    } else {
        // RepairAgent failed, fall back to standard execution
        log('WARN', '[RepairAgent] Failed to generate valid patch, falling back to standard execution');
        return {
            currentNode: 'execution',
            feedback: [...state.feedback, 'RepairAgent failed - using standard execution']
        };
    }
};

export const repairAgentNode = withNodeTracing('repair-agent', repairAgentNodeHandler);
