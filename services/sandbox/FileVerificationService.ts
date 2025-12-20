import { SandboxEnvironment } from '../../sandbox';
import { AppConfig } from '../../types';

export class FileVerificationService {

    /**
     * Verifies if the content of a candidate file matches the expected purpose.
     */
    async verifyContentMatch(config: AppConfig, expectedPurpose: string, candidatePath: string, sandbox: SandboxEnvironment): Promise<boolean> {
        try {
            const content = await sandbox.readFile(candidatePath);
            
            if (expectedPurpose.toLowerCase().includes('requirements')) {
                // Check for Python dependency patterns: name==version, name>=version, etc.
                // Must start with alphanumeric and eventually contain a version specifier or be just a name
                const dependencyPattern = /^[a-zA-Z0-9_\-[\]]+(\s*[=<>!~]=?\s*[a-zA-Z0-9.*]+)?$/;
                const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                
                if (lines.length === 0) return false;
                
                // If at least 50% of non-empty lines look like dependencies, consider it a match
                const matchCount = lines.filter(l => dependencyPattern.test(l.trim())).length;
                return (matchCount / lines.length) >= 0.5;
            }

            if (expectedPurpose.toLowerCase().includes('package.json')) {
                try {
                    const parsed = JSON.parse(content);
                    return !!(parsed.dependencies || parsed.devDependencies || parsed.name);
                } catch {
                    return false;
                }
            }

            // Default: if no specific logic, assume match if file is not empty
            return content.trim().length > 0;
        } catch (e) {
            // Silently fail or log to a logger if available
        }
        return false;
    }

    /**
     * Attempts a dry-run of a command to see if it succeeds.
     */
    async dryRunBuild(config: AppConfig, command: string, sandbox: SandboxEnvironment): Promise<boolean> {
        try {
            const result = await sandbox.runCommand(command);
            return result.exitCode === 0;
        } catch (e) {
            // Silently fail
        }
        return false;
    }
}