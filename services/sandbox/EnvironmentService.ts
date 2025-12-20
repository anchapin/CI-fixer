import { SandboxEnvironment } from '../../sandbox.js';
import { AppConfig } from '../../types.js';

export class EnvironmentService {
    /**
     * Refreshes dependencies in the sandbox environment.
     * Uses 'pnpm install' by default, but could be extended for other managers.
     */
    async refreshDependencies(config: AppConfig, sandbox: SandboxEnvironment): Promise<void> {
        console.log('[EnvironmentService] Refreshing dependencies...');
        await sandbox.runCommand('pnpm install --no-frozen-lockfile');
    }

    /**
     * Forcibly purges node_modules and package manager cache.
     */
    async purgeEnvironment(config: AppConfig, sandbox: SandboxEnvironment): Promise<void> {
        console.log('[EnvironmentService] Purging environment...');
        await sandbox.runCommand('rm -rf node_modules');
        await sandbox.runCommand('pnpm store prune');
    }

    /**
     * Attempts to repair broken patches using patch-package.
     */
    async repairPatches(config: AppConfig, sandbox: SandboxEnvironment): Promise<void> {
        console.log('[EnvironmentService] Repairing patches...');
        // This assumes patch-package is installed and there are patches to apply
        await sandbox.runCommand('npx patch-package');
    }

    /**
     * Identifies and kills dangling processes that might interfere with tests.
     */
    async killDanglingProcesses(config: AppConfig, sandbox: SandboxEnvironment): Promise<void> {
        console.log('[EnvironmentService] Killing dangling processes...');
        // Kill common test-related processes if they are hanging
        const processesToKill = ['node', 'jest', 'vitest', 'playwright'];
        for (const proc of processesToKill) {
            try {
                // pkill might not be available in all sandboxes, but it's a good default
                await sandbox.runCommand(`pkill -f ${proc} || true`);
            } catch (e) {
                // Ignore errors if process not found or pkill missing
            }
        }
    }
}
