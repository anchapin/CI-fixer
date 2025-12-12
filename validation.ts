import { Octokit } from '@octokit/rest';
import { AppConfig } from './types.js';

// ============================================================================
// REPOSITORY PROFILING
// ============================================================================

export interface RepositoryProfile {
    languages: string[];              // Detected from file extensions
    packageManager: string | null;    // npm, pnpm, poetry, pip, etc.
    buildSystem: string | null;       // vite, webpack, docker, gradle, etc.
    testFramework: string | null;     // vitest, jest, pytest, junit, etc.
    availableScripts: Record<string, string>; // From package.json, Makefile, etc.
    directoryStructure: {
        hasBackend: boolean;
        hasFrontend: boolean;
        testDirectories: string[];
        sourceDirectories: string[];
    };
    configFiles: string[];            // Found config files
    repositorySize: number;           // Number of files analyzed
}

/**
 * Analyzes a GitHub repository to detect project type, structure, and available commands.
 * This helps the agent make informed decisions about which files to edit and commands to run.
 */
export async function analyzeRepository(
    owner: string,
    repo: string,
    ref: string,
    token: string
): Promise<RepositoryProfile> {
    const octokit = new Octokit({ auth: token });

    const profile: RepositoryProfile = {
        languages: [],
        packageManager: null,
        buildSystem: null,
        testFramework: null,
        availableScripts: {},
        directoryStructure: {
            hasBackend: false,
            hasFrontend: false,
            testDirectories: [],
            sourceDirectories: []
        },
        configFiles: [],
        repositorySize: 0
    };

    try {
        // Get repository tree (recursive, up to 100,000 files)
        const { data: treeData } = await octokit.rest.git.getTree({
            owner,
            repo,
            tree_sha: ref,
            recursive: 'true'
        });

        const files = treeData.tree.filter(item => item.type === 'blob');
        profile.repositorySize = files.length;

        // Detect languages from file extensions
        const extensionCounts: Record<string, number> = {};
        files.forEach(file => {
            if (!file.path) return;
            const ext = file.path.split('.').pop()?.toLowerCase();
            if (ext) {
                extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
            }
        });

        // Map extensions to languages
        const languageMap: Record<string, string> = {
            'py': 'python',
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'go': 'go',
            'java': 'java',
            'rs': 'rust',
            'rb': 'ruby',
            'php': 'php',
            'c': 'c',
            'cpp': 'cpp',
            'cs': 'csharp'
        };

        profile.languages = Array.from(
            new Set(
                Object.keys(extensionCounts)
                    .filter(ext => languageMap[ext])
                    .map(ext => languageMap[ext])
            )
        ).sort((a, b) =>
            (extensionCounts[b] || 0) - (extensionCounts[a] || 0)
        );

        // Detect config files and infer tools
        const configFileMap: Record<string, { packageMgr?: string; buildSys?: string; testFw?: string }> = {
            'package.json': { packageMgr: 'npm' },
            'pnpm-lock.yaml': { packageMgr: 'pnpm' },
            'yarn.lock': { packageMgr: 'yarn' },
            'requirements.txt': { packageMgr: 'pip' },
            'pyproject.toml': { packageMgr: 'poetry' },
            'Pipfile': { packageMgr: 'pipenv' },
            'go.mod': { packageMgr: 'go' },
            'Cargo.toml': { packageMgr: 'cargo' },
            'build.gradle': { packageMgr: 'gradle', buildSys: 'gradle' },
            'pom.xml': { packageMgr: 'maven', buildSys: 'maven' },
            'vite.config.ts': { buildSys: 'vite' },
            'vite.config.js': { buildSys: 'vite' },
            'webpack.config.js': { buildSys: 'webpack' },
            'Dockerfile': { buildSys: 'docker' },
            'vitest.config.ts': { testFw: 'vitest' },
            'jest.config.js': { testFw: 'jest' },
            'pytest.ini': { testFw: 'pytest' },
            '.pytest.ini': { testFw: 'pytest' }
        };

        files.forEach(file => {
            if (!file.path) return;
            const basename = file.path.split('/').pop() || '';

            // Track config files
            if (configFileMap[basename]) {
                profile.configFiles.push(file.path);
                const info = configFileMap[basename];
                if (info.packageMgr) {
                    // Prioritize lockfiles over package.json
                    if (basename === 'pnpm-lock.yaml' || basename === 'yarn.lock') {
                        profile.packageManager = info.packageMgr;
                    } else if (!profile.packageManager) {
                        profile.packageManager = info.packageMgr;
                    }
                }
                if (info.buildSys && !profile.buildSystem) {
                    profile.buildSystem = info.buildSys;
                }
                if (info.testFw && !profile.testFramework) {
                    profile.testFramework = info.testFw;
                }
            }

            // Detect directory structure
            if (file.path.includes('backend/') || file.path.includes('server/')) {
                profile.directoryStructure.hasBackend = true;
            }
            if (file.path.includes('frontend/') || file.path.includes('client/') || file.path.includes('web/')) {
                profile.directoryStructure.hasFrontend = true;
            }
            if (file.path.includes('test/') || file.path.includes('tests/') || file.path.includes('__tests__/')) {
                const testDir = file.path.split('/').slice(0, -1).join('/');
                if (!profile.directoryStructure.testDirectories.includes(testDir)) {
                    profile.directoryStructure.testDirectories.push(testDir);
                }
            }
            if (file.path.includes('src/') || file.path.includes('lib/')) {
                const srcDir = file.path.split('/').slice(0, -1).join('/');
                if (!profile.directoryStructure.sourceDirectories.includes(srcDir)) {
                    profile.directoryStructure.sourceDirectories.push(srcDir);
                }
            }
        });

        // Limit arrays to first 10 entries
        profile.directoryStructure.testDirectories = profile.directoryStructure.testDirectories.slice(0, 10);
        profile.directoryStructure.sourceDirectories = profile.directoryStructure.sourceDirectories.slice(0, 10);

        // Parse package.json for available scripts
        const packageJsonFile = files.find(f => f.path === 'package.json');
        if (packageJsonFile) {
            try {
                const { data: pkgContent } = await octokit.rest.git.getBlob({
                    owner,
                    repo,
                    file_sha: packageJsonFile.sha!
                });
                const decoded = Buffer.from(pkgContent.content, 'base64').toString('utf-8');
                const pkg = JSON.parse(decoded);
                if (pkg.scripts) {
                    profile.availableScripts = pkg.scripts;
                }
            } catch (e) {
                console.warn('[Profile] Failed to parse package.json:', e);
            }
        }

        return profile;
    } catch (error: any) {
        console.error('[Profile] Repository analysis failed:', error.message);
        throw new Error(`Failed to analyze repository: ${error.message}`);
    }
}

// ============================================================================
// FILE VALIDATION
// ============================================================================

export interface FileValidationResult {
    valid: string[];    // Files that exist
    invalid: string[];  // Files that don't exist
}

/**
 * Validates that the specified files exist in the repository at the given ref.
 * Uses GitHub Tree API for efficient batch checking.
 */
export async function validateFilesExist(
    owner: string,
    repo: string,
    ref: string,
    filePaths: string[],
    token: string
): Promise<FileValidationResult> {
    const octokit = new Octokit({ auth: token });

    try {
        // Get repository tree
        const { data: treeData } = await octokit.rest.git.getTree({
            owner,
            repo,
            tree_sha: ref,
            recursive: 'true'
        });

        const existingPaths = new Set(
            treeData.tree
                .filter(item => item.type === 'blob')
                .map(item => item.path)
        );

        const valid: string[] = [];
        const invalid: string[] = [];

        filePaths.forEach(path => {
            if (existingPaths.has(path)) {
                valid.push(path);
            } else {
                invalid.push(path);
            }
        });

        return { valid, invalid };
    } catch (error: any) {
        console.error('[Validation] File existence check failed:', error.message);
        // Fail safe: assume all files are invalid if we can't verify
        return {
            valid: [],
            invalid: filePaths
        };
    }
}

/**
 * Convenience function to check a single file's existence.
 */
export async function validateFileExists(
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
    token: string
): Promise<boolean> {
    const result = await validateFilesExist(owner, repo, ref, [filePath], token);
    return result.valid.length > 0;
}

// ============================================================================
// COMMAND VALIDATION
// ============================================================================

export interface CommandValidationResult {
    valid: boolean;
    suggestion?: string;
    reason?: string;
}

/**
 * Validates that a proposed command is executable in the repository context.
 * Checks:
 * - Command references valid scripts from package.json
 * - Test commands reference actual test files
 * - Build commands match the detected build system
 */
export function validateCommand(
    command: string,
    profile: RepositoryProfile
): CommandValidationResult {
    // Normalize command
    const cmd = command.trim().toLowerCase();

    // 1. Check for common command syntax errors (PRIORITY)
    if (cmd.includes('pip install -r') && !cmd.match(/pip install -r \S+/)) {
        return {
            valid: false,
            reason: 'Incomplete pip install command',
            suggestion: 'Specify requirements file: pip install -r requirements.txt'
        };
    }

    if (cmd.includes('npm install') && cmd.includes('-r')) {
        return {
            valid: false,
            reason: 'Invalid npm install syntax',
            suggestion: 'npm install does not use -r flag. Did you mean pip install -r?'
        };
    }

    // 2. Check for npm/pnpm/yarn script references
    if (cmd.startsWith('npm ') || cmd.startsWith('pnpm ') || cmd.startsWith('yarn ')) {
        const scriptMatch = cmd.match(/(?:npm|pnpm|yarn)\s+(?:run\s+)?([a-z0-9:-]+)/);
        if (scriptMatch) {
            const scriptName = scriptMatch[1];

            // Special commands that don't need package.json
            const builtInCommands = ['install', 'ci', 'test', 'start', 'build'];
            if (builtInCommands.includes(scriptName)) {
                return { valid: true };
            }

            // Check if script exists in package.json
            if (profile.availableScripts[scriptName]) {
                return { valid: true };
            }

            // Suggest available scripts
            const available = Object.keys(profile.availableScripts).join(', ');
            return {
                valid: false,
                reason: `Script "${scriptName}" not found in package.json`,
                suggestion: available ? `Available scripts: ${available}` : 'No scripts defined'
            };
        }
    }

    // 3. Check for Python test commands
    if (cmd.includes('pytest') || cmd.includes('python -m pytest')) {
        if (!profile.testFramework || profile.testFramework !== 'pytest') {
            return {
                valid: false,
                reason: 'pytest not detected in repository',
                suggestion: 'Check if pytest is installed or use a different test command'
            };
        }
        return { valid: true };
    }

    // 4. Check for build commands matching build system
    if (cmd.includes('vite') && profile.buildSystem !== 'vite') {
        return {
            valid: false,
            reason: 'Vite not detected as build system',
            suggestion: profile.buildSystem ? `Use ${profile.buildSystem} instead` : 'Check build configuration'
        };
    }

    if (cmd.includes('webpack') && profile.buildSystem !== 'webpack') {
        return {
            valid: false,
            reason: 'Webpack not detected as build system',
            suggestion: profile.buildSystem ? `Use ${profile.buildSystem} instead` : 'Check build configuration'
        };
    }

    // 5. Check for Docker commands
    if (cmd.startsWith('docker') && profile.buildSystem !== 'docker') {
        return {
            valid: false,
            reason: 'No Dockerfile detected in repository',
            suggestion: 'Verify Docker is being used in this project'
        };
    }

    // 6. Default: assume valid if no specific issues detected
    return { valid: true };
}

/**
 * Suggests a valid command based on the repository profile.
 * Useful when the agent needs to run tests or build but doesn't know the exact command.
 */
export function suggestCommand(
    intent: 'test' | 'build' | 'lint' | 'install',
    profile: RepositoryProfile
): string | null {
    switch (intent) {
        case 'test':
            if (profile.availableScripts['test']) {
                return `${profile.packageManager || 'npm'} test`;
            }
            if (profile.testFramework === 'pytest') {
                return 'pytest';
            }
            if (profile.testFramework === 'jest' || profile.testFramework === 'vitest') {
                return `${profile.packageManager || 'npm'} test`;
            }
            return null;

        case 'build':
            if (profile.availableScripts['build']) {
                return `${profile.packageManager || 'npm'} run build`;
            }
            if (profile.buildSystem === 'vite') {
                return 'vite build';
            }
            if (profile.buildSystem === 'webpack') {
                return 'webpack';
            }
            if (profile.buildSystem === 'docker') {
                return 'docker build -t app .';
            }
            return null;

        case 'lint':
            if (profile.availableScripts['lint']) {
                return `${profile.packageManager || 'npm'} run lint`;
            }
            return null;

        case 'install':
            if (profile.packageManager === 'pnpm') {
                return 'pnpm install';
            }
            if (profile.packageManager === 'yarn') {
                return 'yarn install';
            }
            if (profile.packageManager === 'npm') {
                return 'npm ci';
            }
            if (profile.packageManager === 'pip') {
                return 'pip install -r requirements.txt';
            }
            if (profile.packageManager === 'poetry') {
                return 'poetry install';
            }
            return null;

        default:
            return null;
    }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Formats a repository profile into a human-readable summary for LLM context.
 */
export function formatProfileSummary(profile: RepositoryProfile): string {
    const lines: string[] = [
        '=== Repository Profile ===',
        `Languages: ${profile.languages.join(', ') || 'Unknown'}`,
        `Package Manager: ${profile.packageManager || 'None'}`,
        `Build System: ${profile.buildSystem || 'None'}`,
        `Test Framework: ${profile.testFramework || 'None'}`,
        `Repository Size: ${profile.repositorySize} files`,
        ''
    ];

    if (Object.keys(profile.availableScripts).length > 0) {
        lines.push('Available Scripts:');
        Object.entries(profile.availableScripts).forEach(([name, cmd]) => {
            lines.push(`  ${name}: ${cmd}`);
        });
        lines.push('');
    }

    lines.push('Directory Structure:');
    lines.push(`  Backend: ${profile.directoryStructure.hasBackend ? 'Yes' : 'No'}`);
    lines.push(`  Frontend: ${profile.directoryStructure.hasFrontend ? 'Yes' : 'No'}`);

    if (profile.directoryStructure.testDirectories.length > 0) {
        lines.push(`  Test Directories: ${profile.directoryStructure.testDirectories.join(', ')}`);
    }

    if (profile.directoryStructure.sourceDirectories.length > 0) {
        lines.push(`  Source Directories: ${profile.directoryStructure.sourceDirectories.join(', ')}`);
    }

    return lines.join('\n');
}
