
import { AppConfig } from '../../types.js';
import { SandboxEnvironment } from '../../sandbox.js';

export interface ValidationIssue {
    line?: number;
    column?: number;
    code: string;
    message: string;
    level: 'error' | 'warning' | 'info';
}

export interface DockerfileValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    buildOutput?: string;
}

/**
 * Service for validating Dockerfiles using linting and build checks
 */
export class DockerfileValidator {
    /**
     * Validates a Dockerfile using hadolint and a dry-run build
     */
    static async validate(
        config: AppConfig,
        filePath: string,
        sandbox: SandboxEnvironment
    ): Promise<DockerfileValidationResult> {
        const issues: ValidationIssue[] = [];
        let valid = true;

        // 1. Run Hadolint
        try {
            const hadolintRes = await sandbox.runCommand(`hadolint ${filePath} --format json`);
            if (hadolintRes.exitCode !== 0 && hadolintRes.stdout.trim().length > 0) {
                const results = JSON.parse(hadolintRes.stdout);
                if (Array.isArray(results)) {
                    results.forEach((r: any) => {
                        issues.push({
                            line: r.line,
                            column: r.column,
                            code: r.code,
                            message: r.message,
                            level: r.level === 'error' ? 'error' : (r.level === 'warning' ? 'warning' : 'info')
                        });
                        if (r.level === 'error') valid = false;
                    });
                }
            }
        } catch (e) {
            console.warn('[DockerfileValidator] Hadolint failed or not found:', e);
            // Non-critical if hadolint is missing, but we log it
        }

        // 2. Run Docker Build (Parsability check)
        let buildOutput = "";
        try {
            // Use a lightweight build check if possible, otherwise a standard build
            // Note: On some systems, we might want to use --no-cache or a specific tag
            const buildRes = await sandbox.runCommand(`docker build -f ${filePath} . --dry-run || docker build -f ${filePath} . --cache-from alpine:latest --tag temp-build-check`);
            buildOutput = buildRes.stdout + "\n" + buildRes.stderr;
            
            if (buildRes.exitCode !== 0) {
                valid = false;
                issues.push({
                    code: 'BUILD_ERROR',
                    message: `Docker build failed: ${buildRes.stderr}`,
                    level: 'error'
                });
            }
        } catch (e: any) {
            console.error('[DockerfileValidator] Docker build check failed:', e);
            valid = false;
            issues.push({
                code: 'EXECUTION_ERROR',
                message: `Failed to execute docker build: ${e.message}`,
                level: 'error'
            });
        }

        return {
            valid,
            issues,
            buildOutput
        };
    }
}
