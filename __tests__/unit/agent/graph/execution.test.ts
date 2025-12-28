
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codingNode } from '../../../../agent/graph/nodes/execution';
import * as LogAnalysisService from '../../../../services/analysis/LogAnalysisService';
import { AgentPhase } from '../../../../types';
import * as path from 'node:path';
import { markNodeSolved } from '../../../../services/dag-executor';

// Mock dependencies
vi.mock('../../../../services/analysis/LogAnalysisService', () => ({
    generateFix: vi.fn(),
    judgeFix: vi.fn(),
}));

vi.mock('../../../../services/sandbox/SandboxService', () => ({
    toolLintCheck: vi.fn().mockResolvedValue({ valid: true }),
    toolWebSearch: vi.fn(),
}));

vi.mock('../../../../services/dag-executor', () => ({
    markNodeSolved: vi.fn((state: any, id: string) => ({ solvedNodes: [id], currentNodeId: undefined }))
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
            feedback: [],
            solvedNodes: []
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
        expect(result.currentNode).toBeUndefined();
    });

    it('should handle self-healing failure (install failed)', async () => {
        mockState.diagnosis.fixAction = 'command';
        mockState.diagnosis.suggestedCommand = 'npm install';

        mockSandbox.runCommand
            .mockResolvedValueOnce({ stdout: '', stderr: ': npm: not found', exitCode: 127 })
            .mockResolvedValueOnce({ stdout: '', stderr: 'apt failed', exitCode: 1 });

        const result = await codingNode(mockState, mockContext);
        expect(result.currentNode).toBe('analysis');
        expect(result.feedback[0]).toContain('Command Failed');
    });

    it('should handle self-healing failure (retry failed)', async () => {
        mockState.diagnosis.fixAction = 'command';
        mockState.diagnosis.suggestedCommand = 'npm install';

        mockSandbox.runCommand
            .mockResolvedValueOnce({ stdout: '', stderr: ': npm: not found', exitCode: 127 })
            .mockResolvedValueOnce({ stdout: 'installed', stderr: '', exitCode: 0 })
            .mockResolvedValueOnce({ stdout: '', stderr: 'still fails', exitCode: 1 });

        const result = await codingNode(mockState, mockContext);
        expect(result.currentNode).toBe('analysis');
        expect(result.feedback[0]).toContain('after installing missing tool');
    });

    it('should handle path hallucination (multiple matches)', async () => {
        mockContext.services.discovery.findUniqueFile.mockResolvedValueOnce({
            found: false,
            matches: ['/work/src/file.ts', '/work/tests/file.ts']
        });

        const result = await codingNode(mockState, mockContext);
        expect(result.currentNode).toBe('analysis');
        expect(result.feedback[0]).toContain('Multiple files named');
    });

    it('should handle auto-correction of path', async () => {
        mockContext.services.discovery.findUniqueFile.mockResolvedValueOnce({
            found: true,
            path: '/mock/workdir/src/file.ts'
        });
        mockState.fileReservations = ['wrong/file.ts'];

        await codingNode(mockState, mockContext);
        expect(mockContext.logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Auto-corrected path'));
    });

    it('should mark DAG node as solved', async () => {
        mockState.currentNodeId = 'task-1';
        mockState.errorDAG = { nodes: [{ id: 'task-1' }], edges: [] };
        
        const result = await codingNode(mockState, mockContext);
        expect(result.currentNode).toBe('planning');
        expect(markNodeSolved).toHaveBeenCalled();
    });
});
