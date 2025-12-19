import { NodeHandler } from '../state.js';
import { withNodeTracing } from './tracing-wrapper.js';

const verificationNodeHandler: NodeHandler = async (state, context) => {
    const { config, group, iteration, diagnosis, files } = state;
    const { logCallback, sandbox, services } = context;
    const log = (level: string, msg: string) => logCallback(level as any, msg);

    log('INFO', '[VerificationNode] Verifying changes...');

    // 1. Apply Changes to Sandbox
    if (sandbox) {
        log('VERBOSE', `[Verification] Writing ${Object.keys(files).length} files to sandbox.`);
        for (const path of Object.keys(files)) {
            const change = files[path];
            if (change.status === 'modified' && change.modified) {
                log('VERBOSE', `[Verification] Writing ${path}`);
                await sandbox.writeFile(path, change.modified.content);
            }
        }
    }

    // 2. Local Verification (Reproduction Command)
    if (diagnosis?.reproductionCommand && sandbox) {
        log('INFO', `Running reproduction command: ${diagnosis.reproductionCommand}`);
        const res = await sandbox.runCommand(diagnosis.reproductionCommand);
        if (res.exitCode !== 0) {
            log('WARN', `Reproduction command failed: ${res.stdout}\n${res.stderr}`);
            // Logic to determine if this is "Good" (we reproduced it) or "Bad" (we failed to fix it).
            // Usually in Verification Phase, failure means "Fix didn't work".
            // So we treat non-zero exit as Verification Failure.

            return {
                feedback: [...state.feedback, `Verification Failed:\nStdout: ${res.stdout}\nStderr: ${res.stderr}`],
                iteration: iteration + 1,
                currentNode: 'analysis' // Loop back
            };
        } else {
            log('SUCCESS', 'Reproduction command passed.');
        }
    }

    // 3. Full Suite Verification
    // We only run this if repro passed or if no repro command exists
    // We need to construct a "FileChange" object representing the aggregate change?
    // runSandboxTest takes a single FileChange. We might need to adapt it.
    // For now, stick to the main active file.
    // 3. Full Suite Verification
    const mainChange = Object.values(files)[0];

    if (!mainChange) {
        // For command-based fixes, no file modifications is expected behavior
        if (diagnosis?.fixAction === 'command') {
            log('SUCCESS', '[Verification] Command fix completed. No file modifications expected.');

            // CRITICAL CHANGE: We only assume success if we actually passed a reproduction command (lines 28-45).
            // If we are here, it means reproductionCommand was either successful OR it didn't exist.

            if (!diagnosis.reproductionCommand) {
                log('WARN', '[Verification] No reproduction command provided to verify this fix.');
                return {
                    feedback: [...state.feedback, 'Action executed, but no `reproductionCommand` was available to verify the fix. Please provide a reproduction command to confirm the issue is resolved.'],
                    iteration: iteration + 1,
                    currentNode: 'analysis'
                };
            }

            // If we had a reproduction command, and we didn't return early in step 2 (failure),
            // then it passed. So this is a valid success.
            return {
                status: 'success',
                currentNode: 'finish'
            };
        }

        // For edit-based fixes, no files modified is an error
        log('WARN', '[Verification] No files modified. Skipping verification.');
        return {
            feedback: [...state.feedback, 'No files modified.'],
            iteration: iteration + 1,
            currentNode: 'analysis'
        };
    }

    const testResult = await services.analysis.runSandboxTest(
        config,
        group,
        iteration,
        true, // isVerification
        mainChange,
        diagnosis?.summary || "Fix",
        logCallback,
        files, // Pass all files map
        sandbox
    );

    log('VERBOSE', `[Verification] Test Result: ${JSON.stringify(testResult)}`);
    log('DEBUG', `[Verification] Test passed: ${testResult.passed}, iteration: ${iteration}`);

    if (testResult.passed) {
        log('SUCCESS', 'All tests passed. Task Complete.');

        // Final Fix Judgment
        if (sandbox && diagnosis && mainChange) {
            try {
                const original = mainChange.original?.content || "";
                const fixed = mainChange.modified?.content || "";
                const judgment = await services.analysis.judgeFix(config, original, fixed, diagnosis.summary);
                if (!judgment.passed) {
                    log('WARN', `Judge rejected fix: ${judgment.reasoning}`);
                    return {
                        feedback: [...state.feedback, `Judge Rejected: ${judgment.reasoning}`],
                        iteration: iteration + 1,
                        currentNode: 'analysis'
                    };
                }
            } catch (ignore) { /* Best effort */ }
        }

        // ToolOrchestra: Calculate and record reward
        const diffSize = Object.values(files).reduce((sum, f) => {
            if (!f.modified || !f.original) return sum;
            const origLines = f.original.content.split('\n').length;
            const modLines = f.modified.content.split('\n').length;
            return sum + Math.abs(modLines - origLines);
        }, 0);

        const runMetrics = {
            success: true,
            llmCost: state.totalCostAccumulated || 0,
            totalLatency: state.totalLatencyAccumulated || 0,
            llmTokensInput: state.llmMetrics?.reduce((sum, m) => sum + m.tokensInput, 0) || 0,
            llmTokensOutput: state.llmMetrics?.reduce((sum, m) => sum + m.tokensOutput, 0) || 0,
            toolCallCount: state.selectedTools?.length || 0,
            diffSize
        };

        // Use LearningLoopService to record everything
        const signal = await services.learning.processRunOutcome(
            group.id,
            state.classification?.category || 'UNKNOWN',
            state.problemComplexity || 5,
            state.selectedTools || [],
            runMetrics
        );

        log('INFO', `[Verification] Reward: ${signal.reward.toFixed(2)}`);

        return {
            status: 'success',
            currentNode: 'finish',
            rewardHistory: [...(state.rewardHistory || []), signal.reward]
        };
    } else {
        log('WARN', `Full verification failed: ${testResult.logs.substring(0, 100)}...`);

        // ToolOrchestra: Record failed attempt
        const runMetrics = {
            success: false,
            llmCost: state.totalCostAccumulated || 0,
            totalLatency: state.totalLatencyAccumulated || 0,
            llmTokensInput: state.llmMetrics?.reduce((sum, m) => sum + m.tokensInput, 0) || 0,
            llmTokensOutput: state.llmMetrics?.reduce((sum, m) => sum + m.tokensOutput, 0) || 0,
            toolCallCount: state.selectedTools?.length || 0
        };

        const signal = await services.learning.processRunOutcome(
            group.id,
            state.classification?.category || 'UNKNOWN',
            state.problemComplexity || 5,
            state.selectedTools || [],
            runMetrics
        );

        log('INFO', `[Verification] Reward (failed): ${signal.reward.toFixed(2)}`);

        return {
            feedback: [...state.feedback, `Test Suite Failed:\n${services.context.thinLog(testResult.logs, 200)}`],
            iteration: iteration + 1,
            currentNode: 'analysis', // Loop back
            rewardHistory: [...(state.rewardHistory || []), signal.reward]
        };
    }
};

export const verificationNode = withNodeTracing('verification', verificationNodeHandler);
