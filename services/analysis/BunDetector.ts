import * as fs from 'fs/promises';
import * as path from 'path';

export class BunDetector {
    /**
     * Checks for the presence of bun.lockb in the project root.
     */
    static async detectBunLock(projectRoot: string): Promise<boolean> {
        try {
            const lockPath = path.join(projectRoot, 'bun.lockb');
            const stats = await fs.stat(lockPath);
            return stats.isFile();
        } catch (error: any) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    }

    /**
     * Checks for the presence of bunfig.toml in the project root.
     */
    static async detectBunConfig(projectRoot: string): Promise<boolean> {
        try {
            const configPath = path.join(projectRoot, 'bunfig.toml');
            const stats = await fs.stat(configPath);
            return stats.isFile();
        } catch (error: any) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
    }

    /**
     * Scans source files for "bun:" imports (e.g., "bun:test").
     * Limits recursion depth and ignores node_modules/git.
     */
    static async scanForBunImports(dirPath: string, depth = 0, maxDepth = 5): Promise<boolean> {
        if (depth > maxDepth) return false;

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    if (['node_modules', '.git', 'dist', 'build', '__tests__', 'tests', 'coverage'].includes(entry.name)) {
                        continue;
                    }
                    const foundInSubDir = await this.scanForBunImports(fullPath, depth + 1, maxDepth);
                    if (foundInSubDir) return true;
                } else if (entry.isFile()) {
                    if (/\.(ts|js|tsx|jsx|mjs|cjs)$/.test(entry.name)) {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        // Split strings to avoid self-detection
                        if (content.includes('from "bu' + 'n:') || content.includes("from 'bu" + "n:")) {
                            return true;
                        }
                    }
                }
            }
        } catch (error) {
            // Ignore access errors
            console.warn(`[BunDetector] Failed to scan directory: ${dirPath}`, error);
        }

        return false;
    }

    /**
     * Comprehensive check to determine if the project uses Bun.
     */
    static async isBunProject(projectRoot: string): Promise<boolean> {
        const hasLock = await this.detectBunLock(projectRoot);
        if (hasLock) return true;

        const hasConfig = await this.detectBunConfig(projectRoot);
        if (hasConfig) return true;

        const hasImports = await this.scanForBunImports(projectRoot);
        return hasImports;
    }
}
