import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    groupFailedRuns,
    diagnoseError,
    generateRepoSummary,
    generateFix,
    judgeFix,
    generateDetailedPlan,
    formatPlanToMarkdown
} from '../../services/analysis/LogAnalysisService.js';
import { AppConfig, WorkflowRun } from '../../types.js';

// Mock dependencies
vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn().mockResolvedValue({
        text: JSON.stringify({
            summary: 'Test error summary',
            filePath: 'test.ts',
            fixAction: 'edit',
            reproductionCommand: 'npm test'
        })
    }),
    safeJsonParse: vi.fn((text, fallback) => {
        try {
            return JSON.parse(text);
        } catch {
            return fallback;
        }
    }),
    extractCode: vi.fn((text) => text.replace(/```[\w]*\n?/g, ''))
}));

vi.mock('../../services/context-compiler.js', () => ({
    filterLogs: vi.fn((logs) => logs),
    summarizeLogs: vi.fn().mockResolvedValue('Log summary')
}));

vi.mock('../../services/sandbox/SandboxService.js', () => ({
    runDevShellCommand: vi.fn().mockResolvedValue({
        output: 'Mock output',
        exitCode: 0
    })
}));

describe('LogAnalysisService', () => {
    let mockConfig: AppConfig;

    beforeEach(() => {
        mockConfig = {
            githubToken: 'test-token',
            repoUrl: 'owner/repo',
            checkEnv: 'simulation',
            devEnv: 'simulation'
        };
        vi.clearAllMocks();
    });

    describe('groupFailedRuns', () => {
        it('should group runs by name', async () => {
            const runs: WorkflowRun[] = [
                { id: 1, name: 'CI', status: 'failed', conclusion: 'failure' } as any,
                { id: 2, name: 'CI', status: 'failed', conclusion: 'failure' } as any,
                { id: 3, name: 'Deploy', status: 'failed', conclusion: 'failure' } as any
            ];

            const groups = await groupFailedRuns(mockConfig, runs);

            expect(groups).toHaveLength(2);
            expect(groups[0].name).toBe('CI');
            expect(groups[0].runIds).toEqual([1, 2]);
            expect(groups[1].name).toBe('Deploy');
            expect(groups[1].runIds).toEqual([3]);
        });

        it('should handle empty runs array', async () => {
            const groups = await groupFailedRuns(mockConfig, []);
            expect(groups).toEqual([]);
        });

        it('should assign unique group IDs', async () => {
            const runs: WorkflowRun[] = [
                { id: 1, name: 'Test', status: 'failed', conclusion: 'failure' } as any,
                { id: 2, name: 'Build', status: 'failed', conclusion: 'failure' } as any
            ];

            const groups = await groupFailedRuns(mockConfig, runs);

            expect(groups[0].id).toMatch(/^GROUP-/);
            expect(groups[1].id).toMatch(/^GROUP-/);
            expect(groups[0].id).not.toBe(groups[1].id);
        });
    });

    describe('diagnoseError', () => {
        it('should diagnose error with minimal context', async () => {
            const result = await diagnoseError(
                mockConfig,
                'Error: Module not found'
            );

            expect(result.summary).toBeDefined();
            expect(result.filePath).toBeDefined();
            expect(result.fixAction).toMatch(/edit|command/);
        });

        it('should include profile context when provided', async () => {
            const profile = {
                languages: ['typescript', 'javascript'],
                packageManager: 'npm',
                buildSystem: 'vite',
                testFramework: 'vitest'
            };

            const result = await diagnoseError(
                mockConfig,
                'Build failed',
                undefined,
                profile
            );

            expect(result).toBeDefined();
        });

        it('should include classification context when provided', async () => {
            const classification = {
                category: 'dependency',
                suggestedAction: 'npm install'
            };

            const result = await diagnoseError(
                mockConfig,
                'Module not found',
                undefined,
                undefined,
                classification
            );

            expect(result).toBeDefined();
        });

        it('should include feedback history when provided', async () => {
            const feedback = [
                'Previous attempt failed: syntax error',
                'Second attempt failed: missing import'
            ];

            const result = await diagnoseError(
                mockConfig,
                'Error continues',
                undefined,
                undefined,
                undefined,
                feedback
            );

            expect(result).toBeDefined();
        });

        it('should detect disk space errors', async () => {
            const result = await diagnoseError(
                mockConfig,
                'Error: No space left on device\nBuild failed'
            );

            expect(result).toBeDefined();
            // The context manager should add a critical disk space hint
        });

        it('should handle diagnosis errors gracefully', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockRejectedValueOnce(new Error('LLM error'));

            const result = await diagnoseError(mockConfig, 'Test error');

            expect(result.summary).toBe('Diagnosis Failed');
            expect(result.fixAction).toBe('edit');
        });

        it('should handle nested result structures', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: JSON.stringify({
                    result: {
                        summary: 'Nested summary',
                        filePath: 'nested.ts',
                        fixAction: 'command'
                    }
                })
            });

            const result = await diagnoseError(mockConfig, 'Error');

            expect(result.summary).toBe('Nested summary');
        });

        it('should handle answer field in response', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: JSON.stringify({
                    answer: 'String answer',
                    filePath: 'test.ts'
                })
            });

            const result = await diagnoseError(mockConfig, 'Error');

            expect(result.summary).toBe('String answer');
        });
    });

    describe('generateRepoSummary', () => {
        it('should return simulation message when no sandbox', async () => {
            const summary = await generateRepoSummary(mockConfig);

            expect(summary).toContain('Simulation Mode');
        });

        it('should generate summary with sandbox', async () => {
            const mockSandbox = {
                runCommand: vi.fn().mockResolvedValue({
                    stdout: './src\n./test',
                    stderr: '',
                    exitCode: 0
                }),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            const summary = await generateRepoSummary(mockConfig, mockSandbox as any);

            expect(summary).toContain('Repository Structure');
        });

        it('should handle errors gracefully', async () => {
            const { runDevShellCommand } = await import('../../services/sandbox/SandboxService.js');

            const mockSandbox = {
                runCommand: vi.fn().mockRejectedValue(new Error('Command failed')),
                getId: () => 'test-sandbox',
                writeFile: vi.fn(),
                init: vi.fn(),
                kill: vi.fn()
            };

            // Mock runDevShellCommand to throw
            vi.mocked(runDevShellCommand).mockRejectedValueOnce(new Error('Command failed'));

            const summary = await generateRepoSummary(mockConfig, mockSandbox as any);

            expect(summary).toContain('Failed to generate repo summary');
        });
    });

    describe('generateFix', () => {
        it('should generate fix code', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: '```typescript\nconst x = 1;\n```'
            });

            const context = {
                error: 'Syntax error',
                code: 'const x = ',
                extraContext: 'Missing semicolon'
            };

            const fix = await generateFix(mockConfig, context);

            expect(fix).toBeDefined();
            expect(typeof fix).toBe('string');
            expect(fix).toContain('const x = 1;');
        });

        it('should handle multi-segment responses', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate)
                .mockResolvedValueOnce({ text: '```typescript\nconst x = 1' })
                .mockResolvedValueOnce({ text: ';\n```' });

            const context = {
                error: 'Incomplete code',
                code: 'const x = '
            };

            const fix = await generateFix(mockConfig, context);

            expect(fix).toBeDefined();
        });
    });

    describe('judgeFix', () => {
        it('should reject identical code', async () => {
            const result = await judgeFix(
                mockConfig,
                'const x = 1;',
                'const x = 1;',
                'Error'
            );

            expect(result.passed).toBe(false);
            expect(result.reasoning).toContain('No changes');
            expect(result.score).toBe(0);
        });

        it('should evaluate different code', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: JSON.stringify({
                    passed: true,
                    score: 8,
                    reasoning: 'Fix looks good'
                })
            });

            const result = await judgeFix(
                mockConfig,
                'const x = 1',
                'const x = 1;',
                'Missing semicolon'
            );

            expect(result.passed).toBe(true);
            expect(result.score).toBeGreaterThan(0);
        });

        it('should handle judge errors gracefully', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockRejectedValueOnce(new Error('Judge error'));

            const result = await judgeFix(
                mockConfig,
                'old code',
                'new code',
                'Error'
            );

            expect(result.passed).toBe(true); // Fallback to passing
            expect(result.reasoning).toContain('Offline');
        });
    });

    describe('generateDetailedPlan', () => {
        it('should generate plan with tasks', async () => {
            const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
            vi.mocked(unifiedGenerate).mockResolvedValueOnce({
                text: JSON.stringify({
                    goal: 'Fix syntax error',
                    tasks: [
                        { id: '1', description: 'Add semicolon', status: 'pending' }
                    ],
                    approved: true
                })
            });

            const plan = await generateDetailedPlan(
                mockConfig,
                'Syntax error',
                'app.ts',
                'Context'
            );

            expect(plan.goal).toBeDefined();
            expect(plan.tasks).toBeInstanceOf(Array);
            expect(plan.approved).toBeDefined();
        });

        it('should handle empty context', async () => {
            const plan = await generateDetailedPlan(
                mockConfig,
                'Error',
                'file.ts'
            );

            expect(plan).toBeDefined();
        });
    });

    describe('formatPlanToMarkdown', () => {
        it('should format plan with completed tasks', () => {
            const plan = {
                goal: 'Fix bugs',
                tasks: [
                    { id: '1', description: 'Task 1', status: 'completed' },
                    { id: '2', description: 'Task 2', status: 'pending' }
                ],
                approved: true
            };

            const markdown = formatPlanToMarkdown(plan);

            expect(markdown).toContain('# Implementation Plan: Fix bugs');
            expect(markdown).toContain('- [x] Task 1');
            expect(markdown).toContain('- [ ] Task 2');
        });

        it('should handle empty tasks', () => {
            const plan = {
                goal: 'Empty plan',
                tasks: [],
                approved: false
            };

            const markdown = formatPlanToMarkdown(plan);

            expect(markdown).toContain('Empty plan');
        });
    });
});
