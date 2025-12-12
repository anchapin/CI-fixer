import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    analyzeRepository,
    validateFilesExist,
    validateFileExists,
    validateCommand,
    suggestCommand,
    formatProfileSummary,
    type RepositoryProfile
} from '../../validation.js';

// Mock Octokit
vi.mock('@octokit/rest', () => {
    const MockOctokit = vi.fn();
    MockOctokit.prototype.rest = {
        git: {
            getTree: vi.fn(),
            getBlob: vi.fn()
        }
    };
    return { Octokit: MockOctokit };
});

describe('Repository Profiling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('analyzeRepository', () => {
        it('should detect TypeScript frontend project', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            // Mock repository tree
            (mockOctokit.rest.git.getTree as any).mockResolvedValue({
                data: {
                    tree: [
                        { type: 'blob', path: 'frontend/src/App.tsx' },
                        { type: 'blob', path: 'frontend/src/index.ts' },
                        { type: 'blob', path: 'package.json' },
                        { type: 'blob', path: 'vite.config.ts' },
                        { type: 'blob', path: 'vitest.config.ts' },
                        { type: 'blob', path: '__tests__/app.test.ts' }
                    ]
                }
            });

            // Mock package.json
            (mockOctokit.rest.git.getBlob as any).mockResolvedValue({
                data: {
                    content: Buffer.from(JSON.stringify({
                        scripts: {
                            dev: 'vite',
                            build: 'vite build',
                            test: 'vitest'
                        }
                    })).toString('base64')
                }
            });

            const profile = await analyzeRepository('owner', 'repo', 'main', 'token');

            expect(profile.languages).toContain('typescript');
            expect(profile.packageManager).toBe('npm');
            expect(profile.buildSystem).toBe('vite');
            expect(profile.testFramework).toBe('vitest');
            expect(profile.directoryStructure.hasFrontend).toBe(true);
            expect(profile.availableScripts).toHaveProperty('test', 'vitest');
        });

        it('should detect Python backend project', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockResolvedValue({
                data: {
                    tree: [
                        { type: 'blob', path: 'backend/app.py' },
                        { type: 'blob', path: 'backend/models.py' },
                        { type: 'blob', path: 'requirements.txt' },
                        { type: 'blob', path: 'pytest.ini' },
                        { type: 'blob', path: 'tests/test_app.py' }
                    ]
                }
            });

            const profile = await analyzeRepository('owner', 'repo', 'main', 'token');

            expect(profile.languages).toContain('python');
            expect(profile.packageManager).toBe('pip');
            expect(profile.testFramework).toBe('pytest');
            expect(profile.directoryStructure.hasBackend).toBe(true);
        });

        it('should detect monorepo with both frontend and backend', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockResolvedValue({
                data: {
                    tree: [
                        { type: 'blob', path: 'frontend/src/App.tsx' },
                        { type: 'blob', path: 'backend/app.py' },
                        { type: 'blob', path: 'package.json' },
                        { type: 'blob', path: 'requirements.txt' },
                        { type: 'blob', path: 'pnpm-lock.yaml' }
                    ]
                }
            });

            (mockOctokit.rest.git.getBlob as any).mockResolvedValue({
                data: {
                    content: Buffer.from('{}').toString('base64')
                }
            });

            const profile = await analyzeRepository('owner', 'repo', 'main', 'token');

            expect(profile.languages).toContain('typescript');
            expect(profile.languages).toContain('python');
            expect(profile.packageManager).toBe('pnpm'); // pnpm-lock.yaml takes priority
            expect(profile.directoryStructure.hasFrontend).toBe(true);
            expect(profile.directoryStructure.hasBackend).toBe(true);
        });

        it('should handle API errors gracefully', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockRejectedValue(new Error('API rate limit exceeded'));

            await expect(analyzeRepository('owner', 'repo', 'main', 'token'))
                .rejects.toThrow('Failed to analyze repository');
        });
    });
});

describe('File Validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validateFilesExist', () => {
        it('should correctly identify existing and non-existing files', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockResolvedValue({
                data: {
                    tree: [
                        { type: 'blob', path: 'src/App.tsx' },
                        { type: 'blob', path: 'src/index.ts' },
                        { type: 'blob', path: 'package.json' }
                    ]
                }
            });

            const result = await validateFilesExist(
                'owner',
                'repo',
                'main',
                ['src/App.tsx', 'src/NonExistent.tsx', 'package.json'],
                'token'
            );

            expect(result.valid).toEqual(['src/App.tsx', 'package.json']);
            expect(result.invalid).toEqual(['src/NonExistent.tsx']);
        });

        it('should return all files as invalid on API error', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockRejectedValue(new Error('Network error'));

            const result = await validateFilesExist(
                'owner',
                'repo',
                'main',
                ['file1.ts', 'file2.ts'],
                'token'
            );

            expect(result.valid).toEqual([]);
            expect(result.invalid).toEqual(['file1.ts', 'file2.ts']);
        });
    });

    describe('validateFileExists', () => {
        it('should return true for existing file', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockResolvedValue({
                data: {
                    tree: [{ type: 'blob', path: 'src/App.tsx' }]
                }
            });

            const exists = await validateFileExists('owner', 'repo', 'main', 'src/App.tsx', 'token');
            expect(exists).toBe(true);
        });

        it('should return false for non-existing file', async () => {
            const { Octokit } = await import('@octokit/rest');
            const mockOctokit = new Octokit({ auth: 'token' });

            (mockOctokit.rest.git.getTree as any).mockResolvedValue({
                data: {
                    tree: [{ type: 'blob', path: 'src/App.tsx' }]
                }
            });

            const exists = await validateFileExists('owner', 'repo', 'main', 'src/Missing.tsx', 'token');
            expect(exists).toBe(false);
        });
    });
});

describe('Command Validation', () => {
    const mockProfile: RepositoryProfile = {
        languages: ['typescript'],
        packageManager: 'npm',
        buildSystem: 'vite',
        testFramework: 'vitest',
        availableScripts: {
            dev: 'vite',
            build: 'vite build',
            test: 'vitest',
            lint: 'eslint .'
        },
        directoryStructure: {
            hasBackend: false,
            hasFrontend: true,
            testDirectories: ['__tests__'],
            sourceDirectories: ['src']
        },
        configFiles: ['package.json', 'vite.config.ts'],
        repositorySize: 50
    };

    describe('validateCommand', () => {
        it('should validate npm script that exists', () => {
            const result = validateCommand('npm run test', mockProfile);
            expect(result.valid).toBe(true);
        });

        it('should invalidate npm script that does not exist', () => {
            const result = validateCommand('npm run nonexistent', mockProfile);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('not found');
            expect(result.suggestion).toContain('Available scripts');
        });

        it('should validate built-in npm commands', () => {
            const result = validateCommand('npm install', mockProfile);
            expect(result.valid).toBe(true);
        });

        it('should invalidate vite command when build system is not vite', () => {
            const webpackProfile = { ...mockProfile, buildSystem: 'webpack' };
            const result = validateCommand('vite build', webpackProfile);
            expect(result.valid).toBe(false);
            expect(result.suggestion).toContain('webpack');
        });

        it('should invalidate pytest when test framework is not pytest', () => {
            const result = validateCommand('pytest tests/', mockProfile);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('pytest not detected');
        });

        it('should catch incomplete pip install command', () => {
            const result = validateCommand('pip install -r', mockProfile);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Incomplete');
            expect(result.suggestion).toContain('requirements.txt');
        });

        it('should catch invalid npm syntax with -r flag', () => {
            const result = validateCommand('npm install -r package.json', mockProfile);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Invalid npm install syntax');
        });

        it('should invalidate docker commands when no Dockerfile exists', () => {
            const result = validateCommand('docker build -t app .', mockProfile);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('No Dockerfile detected');
        });

        it('should validate docker commands when Docker is the build system', () => {
            const dockerProfile = { ...mockProfile, buildSystem: 'docker' };
            const result = validateCommand('docker build -t app .', dockerProfile);
            expect(result.valid).toBe(true);
        });
    });

    describe('suggestCommand', () => {
        it('should suggest test command based on available scripts', () => {
            const cmd = suggestCommand('test', mockProfile);
            expect(cmd).toBe('npm test');
        });

        it('should suggest build command', () => {
            const cmd = suggestCommand('build', mockProfile);
            expect(cmd).toBe('npm run build');
        });

        it('should suggest lint command', () => {
            const cmd = suggestCommand('lint', mockProfile);
            expect(cmd).toBe('npm run lint');
        });

        it('should suggest install command based on package manager', () => {
            const pnpmProfile = { ...mockProfile, packageManager: 'pnpm' };
            const cmd = suggestCommand('install', pnpmProfile);
            expect(cmd).toBe('pnpm install');
        });

        it('should suggest pytest for Python projects', () => {
            const pythonProfile: RepositoryProfile = {
                ...mockProfile,
                languages: ['python'],
                packageManager: 'pip',
                buildSystem: null,
                testFramework: 'pytest',
                availableScripts: {}
            };
            const cmd = suggestCommand('test', pythonProfile);
            expect(cmd).toBe('pytest');
        });

        it('should return null when no suitable command found', () => {
            const minimalProfile: RepositoryProfile = {
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
            const cmd = suggestCommand('test', minimalProfile);
            expect(cmd).toBeNull();
        });
    });
});

describe('Utility Functions', () => {
    describe('formatProfileSummary', () => {
        it('should format profile into readable summary', () => {
            const profile: RepositoryProfile = {
                languages: ['typescript', 'python'],
                packageManager: 'pnpm',
                buildSystem: 'vite',
                testFramework: 'vitest',
                availableScripts: {
                    test: 'vitest',
                    build: 'vite build'
                },
                directoryStructure: {
                    hasBackend: true,
                    hasFrontend: true,
                    testDirectories: ['__tests__', 'tests'],
                    sourceDirectories: ['src', 'lib']
                },
                configFiles: ['package.json', 'vite.config.ts'],
                repositorySize: 150
            };

            const summary = formatProfileSummary(profile);

            expect(summary).toContain('Languages: typescript, python');
            expect(summary).toContain('Package Manager: pnpm');
            expect(summary).toContain('Build System: vite');
            expect(summary).toContain('Test Framework: vitest');
            expect(summary).toContain('Repository Size: 150 files');
            expect(summary).toContain('Backend: Yes');
            expect(summary).toContain('Frontend: Yes');
            expect(summary).toContain('test: vitest');
            expect(summary).toContain('build: vite build');
        });

        it('should handle minimal profile', () => {
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
                repositorySize: 5
            };

            const summary = formatProfileSummary(profile);

            expect(summary).toContain('Languages: Unknown');
            expect(summary).toContain('Package Manager: None');
            expect(summary).toContain('Build System: None');
            expect(summary).toContain('Backend: No');
            expect(summary).toContain('Frontend: No');
        });
    });
});
