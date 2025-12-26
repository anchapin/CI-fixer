import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runIndependentAgentLoop } from '../../agent.js';
import { MockLLMService } from '../mocks/MockLLM.js';
import { MockSandboxService } from '../mocks/MockSandbox.js';
import { createMockConfig, createMockRunGroup } from '../helpers/test-fixtures.js';
import * as GitHubService from '../../services/github/GitHubService.js';
import * as AnalysisService from '../../services/analysis/LogAnalysisService.js';
import { ServiceContainer } from '../../services/container.js';

// Mock database client (helper defined inline to avoid hoisting issues)
vi.mock('../../db/client.js', () => ({
    db: (() => {
        function createMockDb() {
            return {
                errorFact: { findFirst: vi.fn(), create: vi.fn() },
                fileModification: { create: vi.fn() },
                fixPattern: { findMany: vi.fn(() => Promise.resolve([])), create: vi.fn(), findFirst: vi.fn() },
                errorSolution: { findMany: vi.fn(() => Promise.resolve([])), create: vi.fn() },
                actionTemplate: { findMany: vi.fn(() => Promise.resolve([])), create: vi.fn() }
            };
        }
        return createMockDb();
    })()
}));

// Mock static imports
vi.mock('../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({
        logText: "Error: Syntax Error",
        headSha: "abc",
        jobName: "test"
    }),
    findClosestFile: vi.fn().mockResolvedValue({
        file: { content: "const x = ;", language: "typescript", name: "utils.ts" },
        path: "src/utils.ts"
    })
}));

vi.mock('../../services/sandbox/SandboxService.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        prepareSandbox: vi.fn().mockResolvedValue({
            getId: () => 'mock-sandbox',
            init: vi.fn(),
            teardown: vi.fn(),
            runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
            writeFile: vi.fn(),
            readFile: vi.fn().mockResolvedValue('const x = 10;'),
            getWorkDir: () => '/'
        }),
        toolCodeSearch: vi.fn().mockResolvedValue(["src/utils.ts"]),
        toolWebSearch: vi.fn().mockResolvedValue(""),
        toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
        toolScanDependencies: vi.fn().mockResolvedValue("Deps OK"),
        extractFileOutline: vi.fn().mockReturnValue("Outline")
    };
});

vi.mock('../../services/analysis/LogAnalysisService.js', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        formatPlanToMarkdown: vi.fn().mockReturnValue("Plan"),
    };
});

vi.mock('../../services/analysis/ValidationService.js', () => ({
    runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: "PASS" })
}));

// Hoisted mock reference for LLM
const { mockRef } = vi.hoisted(() => ({ mockRef: { generate: vi.fn() } }));

vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: (config, ...args) => mockRef.generate(...args),
    safeJsonParse: (text, fallback) => {
        try { return JSON.parse(text); } catch { return fallback; }
    },
    extractCode: (text) => text
}));

/**
 * Agent Logic Tests (Refactored with New Patterns)
 * 
 * Demonstrates using MockLLM/MockSandbox with new test helpers
 */
describe('Agent Logic (Refactored)', () => {
    let mockLLM: MockLLMService;
    let mockSandbox: MockSandboxService;
    let services: ServiceContainer;

    beforeEach(() => {
        mockLLM = new MockLLMService();
        mockSandbox = new MockSandboxService();

        // Connect global spy to local instance
        mockRef.generate.mockImplementation((params: any) =>
            mockLLM.unifiedGenerate({} as any, params)
        );

        // Construct service container
        services = {
            llm: mockLLM as any,
            sandbox: mockSandbox as any,
            github: GitHubService as any,
            analysis: AnalysisService as any,
            context: {
                smartThinLog: vi.fn().mockImplementation(async (log) => log),
                thinLog: vi.fn().mockImplementation((log) => log),
                formatHistorySummary: vi.fn().mockReturnValue('History'),
                formatPlanToMarkdown: vi.fn().mockReturnValue('Plan'),
                markNodeSolved: vi.fn().mockReturnValue({ solvedNodes: [] }),
            } as any,
            classification: {
                classifyErrorWithHistory: vi.fn().mockResolvedValue({
                    category: 'logic',
                    confidence: 0.9,
                    errorMessage: 'Error',
                    affectedFiles: [],
                }),
                getErrorPriority: vi.fn().mockReturnValue(5),
                classifyError: vi.fn().mockReturnValue({
                    category: 'logic',
                    confidence: 0.9,
                    errorMessage: 'Error',
                    affectedFiles: [],
                })
            } as any,
            dependency: {
                hasBlockingDependencies: vi.fn().mockResolvedValue(false),
                getBlockedErrors: vi.fn().mockResolvedValue([]),
            } as any,
            clustering: {
                clusterError: vi.fn(),
            } as any,
            complexity: {
                estimateComplexity: vi.fn().mockReturnValue(5),
                detectConvergence: vi.fn().mockReturnValue({ trend: 'stable' }),
                isAtomic: vi.fn().mockReturnValue(false),
                explainComplexity: vi.fn().mockReturnValue('Complexity'),
            } as any,
            repairAgent: {
                getRepairAgentConfig: vi.fn().mockReturnValue({}),
                runRepairAgent: vi.fn(),
            } as any,
            metrics: {
                recordFixAttempt: vi.fn(),
            } as any,
            learning: {
                getStrategyRecommendation: vi.fn().mockResolvedValue({
                    preferredTools: ['llm'],
                    historicalStats: { successRate: 0.8 }
                }),
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 10.0 })
            } as any,
            discovery: {
                findUniqueFile: vi.fn().mockResolvedValue({ found: true, path: 'src/utils.ts', relativePath: 'src/utils.ts', matches: ['src/utils.ts'] }),
                recursiveSearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForRename: vi.fn().mockResolvedValue(null),
                fuzzySearch: vi.fn().mockResolvedValue(null),
                checkGitHistoryForDeletion: vi.fn().mockResolvedValue(false)
            } as any,
            verification: {
                verifyContentMatch: vi.fn().mockResolvedValue(true)
            } as any,
            fallback: {
                generatePlaceholder: vi.fn().mockResolvedValue(undefined)
            } as any
        };
    });

    it('should complete a simple fix loop using mocks', async () => {
        // Queue LLM responses
        mockLLM.queueResponse(JSON.stringify({
            summary: "Simple Syntax Error",
            filePath: "src/utils.ts",
            fixAction: "edit"
        }));

        mockLLM.queueResponse(JSON.stringify({
            goal: "Fix syntax",
            tasks: [],
            approved: true
        }));

        mockLLM.queueResponse("```typescript\nconst x = 10;\n```");

        mockLLM.queueResponse(JSON.stringify({
            passed: true,
            score: 10,
            reasoning: "Perfect fix"
        }));

        // Add extra responses to handle additional calls that happen during verification/processing
        mockLLM.queueResponse(JSON.stringify({
            summary: "Mock Diagnosis",
            filePath: "src/utils.ts",
            fixAction: "edit"
        }));

        mockLLM.queueResponse("Mock Refinement");

        mockLLM.queueResponse(JSON.stringify({
            goal: "Fix syntax",
            tasks: [],
            approved: true
        }));

        mockLLM.queueResponse("```typescript\nconst x = 10;\n```");

        // Use helper to create config
        const config = createMockConfig({
            repoUrl: "https://github.com/mock/repo",
            checkEnv: "e2b"
        });

        // Use helper to create run group
        const group = createMockRunGroup({
            id: 'test-run',
            name: 'Test Run'
        });

        // Prepare file in sandbox
        mockSandbox.setFile('src/utils.ts', 'const x = ;');

        // Override GitHub service
        services.github = {
            ...GitHubService,
            getFileContent: async () => ({
                name: 'utils.ts',
                content: 'const x = ;',
                language: 'typescript'
            }),
            getWorkflowLogs: async () => ({
                logText: "Job 'Build' failed (Exit Code 1)\nError: Syntax Error",
                headSha: 'abc',
                jobName: 'test'
            }),
            findClosestFile: async () => ({
                file: { name: 'utils.ts', content: 'const x = ;', language: 'typescript' },
                path: 'src/utils.ts'
            })
        } as any;

        const logs: string[] = [];
        const result = await runIndependentAgentLoop(
            config,
            group,
            "Repo Context",
            services,
            () => { }, // state update callback
            (level, msg) => {
                logs.push(`[${level}] ${msg}`);
            }
        );

        if (result.status !== 'success') {
            console.error('Agent failed:', result.message);
            console.error('LLM calls:', mockLLM.callHistory.length);
        }

        expect(result.status).toBe('success');
        expect(mockLLM.callHistory.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle diagnosis errors gracefully', async () => {
        // Queue invalid diagnosis
        mockLLM.queueResponse("Invalid JSON {{{");

        const config = createMockConfig({ checkEnv: "e2b" });
        const group = createMockRunGroup();

        const result = await runIndependentAgentLoop(
            config,
            group,
            "",
            services,
            () => { },
            () => { }
        );

        // Should handle gracefully
        expect(result).toBeDefined();
    });

    it('should retry on failed verification', async () => {
        // First attempt - fail
        mockLLM.queueResponse(JSON.stringify({
            summary: "Error",
            filePath: "app.ts",
            fixAction: "edit"
        }));
        mockLLM.queueResponse(JSON.stringify({ goal: "Fix", tasks: [], approved: true }));
        mockLLM.queueResponse("```typescript\nbad fix\n```");
        mockLLM.queueResponse(JSON.stringify({ passed: false, score: 2, reasoning: "Bad" }));

        // Second attempt - pass
        mockLLM.queueResponse(JSON.stringify({
            summary: "Error",
            filePath: "app.ts",
            fixAction: "edit"
        }));
        mockLLM.queueResponse(JSON.stringify({ goal: "Fix", tasks: [], approved: true }));
        mockLLM.queueResponse("```typescript\ngood fix\n```");
        mockLLM.queueResponse(JSON.stringify({ passed: true, score: 10, reasoning: "Good" }));

        const config = createMockConfig({ checkEnv: "e2b" });
        const group = createMockRunGroup();

        mockSandbox.setFile('app.ts', 'error');

        const result = await runIndependentAgentLoop(
            config,
            group,
            "",
            services,
            () => { },
            () => { }
        );

        expect(result.status).toBe('success');
        expect(mockLLM.callHistory.length).toBeGreaterThan(4);
    });
});
