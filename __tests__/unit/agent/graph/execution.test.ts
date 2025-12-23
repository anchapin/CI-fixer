
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codingNode } from '../../../../agent/graph/nodes/execution';
import * as LogAnalysisService from '../../../../services/analysis/LogAnalysisService';
import { AgentPhase } from '../../../../types';
import * as path from 'node:path';

// Mock dependencies
vi.mock('../../../../services/analysis/LogAnalysisService', () => ({
    generateFix: vi.fn(),
    judgeFix: vi.fn(),
}));

vi.mock('../../../../services/sandbox/SandboxService', () => ({
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    toolWebSearch: vi.fn(),
}));

describe('Execution Node', () => {
    let mockState: any;
    let mockContext: any;
    let mockSandbox: any;
    let mockDb: any;
    let mockLogCallback: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockSandbox = {
            runCommand: vi.fn(async () => ({ stdout: 'success', stderr: '', exitCode: 0 })),
            writeFile: vi.fn(),
            readFile: vi.fn(async () => 'original-content'),
            getWorkDir: vi.fn(() => '/mock/workdir')
        };

        mockDb = {
            fileModification: { create: vi.fn().mockResolvedValue({}) },
        };

        mockLogCallback = vi.fn();

        mockContext = {
            logCallback: mockLogCallback,
            sandbox: mockSandbox,
            dbClient: mockDb,
            services: {
                analysis: {
                    generateFix: vi.fn(async () => 'fixed-code')
                },
                sandbox: {
                    toolLintCheck: vi.fn(async () => ({ valid: true }))
                },
                context: {
                    markNodeSolved: vi.fn((state, id) => ({ solvedNodes: [id] }))
                },
                discovery: {
                    findUniqueFile: vi.fn(async (p) => ({ found: true, path: p, matches: [p] }))
                }
            },
        };

        mockState = {
            config: {},
            group: { id: 'test-group' },
            diagnosis: {
                summary: 'Error',
                filePath: 'file.ts',
                fixAction: 'edit',
                suggestedCommand: null
            },
            refinedProblemStatement: 'Fix it',
            fileReservations: ['file.ts'],
            iteration: 0,
            files: {},
            feedback: []
        };
    });

    it('should handle command-based fixes', async () => {
        mockState.diagnosis.fixAction = 'command';
        mockState.diagnosis.suggestedCommand = 'npm install';

        const result = await codingNode(mockState, mockContext);

        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm install');
        expect(result).toEqual(expect.objectContaining({ currentNode: 'verification' }));
    });

    it('should retry command fix with self-healing if tool is missing', async () => {
        mockState.diagnosis.fixAction = 'command';
        mockState.diagnosis.suggestedCommand = 'docker ps';

        mockSandbox.runCommand
            .mockResolvedValueOnce({ stdout: '', stderr: ': docker: command not found', exitCode: 127 }) // Original fail
            .mockResolvedValueOnce({ stdout: 'installed', stderr: '', exitCode: 0 }) // Install success
            .mockResolvedValueOnce({ stdout: 'success', stderr: '', exitCode: 0 }); // Retry success

        const result = await codingNode(mockState, mockContext);

        expect(mockSandbox.runCommand).toHaveBeenCalledTimes(3);
        // 1. docker ps
        // 2. apt-get install docker.io
        // 3. docker ps
    });

    it('should fail if diagnosis is missing', async () => {
        mockState.diagnosis = null;
        const result = await codingNode(mockState, mockContext);
        expect(result.status).toBe('failed');
    });

    it('should implement edit fix', async () => {
        mockContext.services.analysis.generateFix.mockResolvedValue('fixed content');

        const result = await codingNode(mockState, mockContext);

        expect(mockSandbox.readFile).toHaveBeenCalledWith(expect.stringContaining('file.ts'));
        expect(mockContext.services.analysis.generateFix).toHaveBeenCalled();
        expect(mockSandbox.writeFile).toHaveBeenCalledWith(expect.stringContaining('file.ts'), 'fixed content');

        // Check result structure
        expect(result.currentNode).toBe('verification');
    });

    it('should lint check the fix', async () => {
        mockContext.services.analysis.generateFix.mockResolvedValue('bad content');
        mockContext.services.sandbox.toolLintCheck.mockResolvedValueOnce({ valid: false, error: 'Lint fail' });

        const result = await codingNode(mockState, mockContext);

        expect(result.feedback).toContain('Lint Error: Lint fail');
        // Does NOT proceed to Verification if lint fails?
        // NodeHandler returns partial state. 
        // Logic in agent loop determines next node if 'currentNode' is missing?
        // Wait, typical NodeHandler returns 'currentNode'.
        // If missing, it might default?
        // Let's check code: `return { feedback: ..., fileReservations };`
        // It does NOT set currentNode.
        // It relies on Agent Loop default behavior or maybe it stays in execution?
        // Actually, if currentNode is generic, maybe it defaults to 'analysis' if fields missing?
        // But let's just check what it returns.
        expect(result.currentNode).toBeUndefined();
    });
});
