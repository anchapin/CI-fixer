import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verificationNode } from '../../../../../agent/graph/nodes/verification.js';
import { DockerfileValidator } from '../../../../../services/analysis/DockerfileValidator.js';

vi.mock('../../../../../services/analysis/DockerfileValidator.js', () => ({
    DockerfileValidator: {
        validate: vi.fn().mockResolvedValue({ valid: true, issues: [] })
    }
}));

describe('Verification Node', () => {
    let mockState: any;
    let mockContext: any;
    let mockServices: any;
    let mockSandbox: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockSandbox = {
            runCommand: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
            writeFile: vi.fn().mockResolvedValue(undefined),
        };

        mockServices = {
            analysis: {
                runSandboxTest: vi.fn().mockResolvedValue({ passed: true, logs: 'All tests passed' }),
                judgeFix: vi.fn().mockResolvedValue({ passed: true, score: 10, reasoning: 'Perfect' }),
            },
            context: {
                thinLog: vi.fn().mockImplementation((log) => log),
            },
            learning: {
                processRunOutcome: vi.fn().mockResolvedValue({ reward: 10.0 })
            }
        };

        mockContext = {
            logCallback: vi.fn(),
            sandbox: mockSandbox,
            services: mockServices,
            dbClient: {
                trajectory: { create: vi.fn() },
                errorFact: { update: vi.fn() }
            }
        };

        mockState = {
            config: {},
            group: { id: 'group-1' },
            iteration: 0,
            diagnosis: { summary: 'Error', reproductionCommand: 'npm test' },
            files: {
                'src/main.ts': {
                    path: 'src/main.ts',
                    original: { content: 'orig' },
                    modified: { content: 'mod' },
                    status: 'modified'
                }
            },
            feedback: []
        };
    });

    it('should successfully verify a fix and transition to finish', async () => {
        const result = await verificationNode(mockState, mockContext);

        expect(mockSandbox.writeFile).toHaveBeenCalled();
        expect(mockSandbox.runCommand).toHaveBeenCalledWith('npm test');
        expect(mockServices.analysis.runSandboxTest).toHaveBeenCalled();
        expect(result.status).toBe('success');
        expect(result.currentNode).toBe('finish');
    });

    it('should handle reproduction failure', async () => {
        mockSandbox.runCommand.mockResolvedValueOnce({ stdout: 'fail', stderr: 'error', exitCode: 1 });

        const result = await verificationNode(mockState, mockContext);

        expect(result.currentNode).toBe('analysis');
        expect(result.iteration).toBe(1);
        expect(result.feedback![0]).toMatch(/Verification Failed/);
    });

    it('should handle test suite failure', async () => {
        mockServices.analysis.runSandboxTest.mockResolvedValueOnce({ passed: false, logs: 'Tests failed' });

        const result = await verificationNode(mockState, mockContext);

        expect(result.currentNode).toBe('analysis');
        expect(result.feedback![0]).toMatch(/Test Suite Failed/);
    });

    it('should trigger Dockerfile validation when a Dockerfile is modified', async () => {
        mockState.files = {
            'Dockerfile': {
                path: 'Dockerfile',
                original: { content: 'FROM node' },
                modified: { content: 'FROM node\nRUN # bad comment' },
                status: 'modified'
            }
        };

        const validateSpy = vi.mocked(DockerfileValidator.validate);
        validateSpy.mockResolvedValueOnce({ 
            valid: false, 
            issues: [{ level: 'error', message: 'comment error', code: 'SC100', line: 2 }] 
        });

        const result = await verificationNode(mockState, mockContext);

        expect(validateSpy).toHaveBeenCalledWith(expect.anything(), 'Dockerfile', mockSandbox);
        expect(result.currentNode).toBe('analysis');
        expect(result.feedback![0]).toContain('Dockerfile Validation Failed for Dockerfile:');
        expect(result.feedback![0]).toContain('[ERROR] Line 2: comment error (SC100)');
    });
});
