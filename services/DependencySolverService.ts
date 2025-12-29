import { SandboxEnvironment } from '../sandbox.js';
import { ProvisioningService } from './sandbox/ProvisioningService.js';
import { FixPatternService } from './FixPatternService.js';
import { AppConfig, LogLine } from '../types.js';
import { log } from '../utils/logger.js';

export class DependencySolverService {
    private provisioning: ProvisioningService;
    private fixPattern: FixPatternService;

    constructor(
        private sandbox: SandboxEnvironment,
        private services: { provisioning: ProvisioningService, fixPattern: FixPatternService }
    ) {
        this.provisioning = services.provisioning;
        this.fixPattern = services.fixPattern;
    }

    /**
     * Attempts to resolve Python dependency conflicts autonomously.
     */
    async solvePythonConflicts(
        config: AppConfig,
        requirementsContent: string,
        logCallback: (level: LogLine['level'], content: string) => void
    ): Promise<{ success: boolean; modifiedRequirements?: string; error?: string }> {
        logCallback('INFO', '[DependencySolver] Starting Python conflict resolution...');

        // 1. Run Dry Run Report
        logCallback('TOOL', 'Running pip install dry-run report...');
        const reportJson = await this.provisioning.runPipDryRunReport(requirementsContent);
        if (!reportJson) {
            return { success: false, error: 'Failed to generate pip dry-run report.' };
        }

        // 2. Analyze Report for Conflicts
        logCallback('INFO', 'Analyzing report for conflicts...');
        const conflicts = this.fixPattern.analyzePipReportForConflicts(reportJson, requirementsContent);
        
        if (conflicts.length === 0) {
            logCallback('SUCCESS', 'No obvious conflicts detected in dry-run report.');
            // But if we are here, there WAS a problem. Maybe try pip check?
            const checkResult = await this.provisioning.runPipCheck();
            if (checkResult.success) {
                return { success: true };
            } else {
                logCallback('WARN', `Pip check failed: ${checkResult.output}`);
                // Use LLM to suggest relaxation even if analyzer didn't catch specific patterns
                conflicts.push(checkResult.output);
            }
        } else {
            logCallback('WARN', `Detected ${conflicts.length} conflict(s):`);
            conflicts.forEach(c => logCallback('VERBOSE', ` - ${c}`));
        }

        // 3. LLM-Driven Relaxation Strategy
        logCallback('INFO', 'Invoking LLM for constraint relaxation suggestion...');
        // First try 'to_greater_than_or_equal'
        logCallback('VERBOSE', 'Strategy attempt: to_greater_than_or_equal (>=)');
        let suggestedRequirements = await this.fixPattern.generateRelaxationSuggestion(
            conflicts,
            requirementsContent,
            'to_greater_than_or_equal',
            config
        );

        if (!suggestedRequirements) {
            logCallback('WARN', 'LLM failed to suggest modifications with >= strategy. Trying removal strategy...');
            logCallback('VERBOSE', 'Strategy attempt: remove_pin (no versions)');
            suggestedRequirements = await this.fixPattern.generateRelaxationSuggestion(
                conflicts,
                requirementsContent,
                'remove_pin',
                config
            );
        }

        if (!suggestedRequirements) {
            logCallback('ERROR', 'Autonomous resolution failed: LLM provided no suggestion.');
            return { success: false, error: 'LLM failed to provide a valid relaxation suggestion.' };
        }

        logCallback('SUCCESS', 'LLM provided a relaxation suggestion.');
        logCallback('VERBOSE', 'LLM Suggestion:\n' + suggestedRequirements);

        // 4. Verify with pip-compile (if possible)
        logCallback('TOOL', 'Verifying suggestion with pip-compile...');
        const compiledRequirements = await this.provisioning.runPipCompile(suggestedRequirements);
        
        const finalRequirements = compiledRequirements || suggestedRequirements;
        if (compiledRequirements) {
            logCallback('SUCCESS', 'Successfully compiled requirements with pip-compile.');
            logCallback('VERBOSE', 'Compiled requirements:\n' + compiledRequirements);
        } else {
            logCallback('WARN', 'pip-compile failed or not available. Proceeding with LLM suggestion directly.');
        }

        // 5. Final Verification in Sandbox
        logCallback('TOOL', 'Performing final installation and health check in sandbox...');
        try {
            await this.sandbox.writeFile('requirements.txt', finalRequirements);
            
            logCallback('VERBOSE', 'Running pip install...');
            const installResult = await this.provisioning.runPipInstall();
            
            if (!installResult.success) {
                logCallback('ERROR', `Resolution failed: Installation error: ${installResult.output}`);
                return { success: false, error: `Installation failed after relaxation: ${installResult.output}` };
            }

            logCallback('VERBOSE', 'Running pip check...');
            const checkResult = await this.provisioning.runPipCheck();
            if (!checkResult.success) {
                logCallback('ERROR', `Resolution failed: Compatibility check failed: ${checkResult.output}`);
                return { success: false, error: `Pip check failed after relaxation: ${checkResult.output}` };
            }

            logCallback('SUCCESS', 'Dependencies resolved and verified successfully.');
            return { success: true, modifiedRequirements: finalRequirements };
        } catch (e) {
            logCallback('ERROR', `Unexpected error during final verification: ${e}`);
            return { success: false, error: `Verification crash: ${e}` };
        }
    }
}
