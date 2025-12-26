import { SandboxEnvironment } from '../../sandbox.js';
import { AppConfig } from '../../types.js';
import { BunDetector } from '../analysis/BunDetector.js';

export class EnvironmentService {
    /**
     * Refreshes dependencies in the sandbox environment.
     * Uses 'bun install' for Bun projects, otherwise 'pnpm install'.
     */
    async refreshDependencies(config: AppConfig, sandbox: SandboxEnvironment): Promise<void> {
        console.log('[EnvironmentService] Refreshing dependencies...');
        
        // In sandbox, we check for Bun indicators
        const projectRoot = sandbox.getWorkDir();
        
        // We need a way to check files in sandbox. 
        // SandboxEnvironment has runCommand, we can use it to check for lockfiles.
        const lsRes = await sandbox.runCommand('ls bun.lockb bunfig.toml package.json');
        const output = lsRes.stdout;
        
        if (output.includes('bun.lockb') || output.includes('bunfig.toml')) {
            console.log('[EnvironmentService] Bun project detected. Using bun install...');
            await sandbox.runCommand('bun install');
            return;
        }

        if (output.includes('package.json')) {
            const pkgContent = await sandbox.runCommand('cat package.json');
            if (pkgContent.stdout.includes('"bun"')) {
                console.log('[EnvironmentService] Bun detected in package.json. Using bun install...');
                await sandbox.runCommand('bun install');
                return;
            }
        }

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
        const processesToKill = ['node', 'jest', 'vitest', 'playwright', 'bun'];
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
