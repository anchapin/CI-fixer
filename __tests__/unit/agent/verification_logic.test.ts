
import { verificationNode } from '../../../agent/graph/nodes/verification.js';
import { describe, it, expect, vi } from 'vitest';

describe('VerificationNode Logic', () => {
    // Mock State and Context
    const mockLog = vi.fn();
    const mockContext = {
        logCallback: mockLog,
        sandbox: {
            writeFile: vi.fn(),
            runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
        },
        services: {
            analysis: {
                runSandboxTest: vi.fn()
            },
            classification: {
                classifyError: vi.fn().mockResolvedValue({ type: 'test', confidence: 0.9 })
            }
        }
    } as any;

    it('should REJECT command fix if no reproductionCommand is provided', async () => {
        const state: any = {
            config: {},
            group: {},
            iteration: 1,
            diagnosis: {
                fixAction: 'command',
                reproductionCommand: undefined // MISSING
            },
            files: {},
            feedback: []
        };

        const result = await verificationNode(state, mockContext);

        // Phase 2 reliability: Halts workflow with 'finish' instead of looping back to 'analysis'
        expect(result.currentNode).toBe('finish');
        expect(result.status).toBe('failed');
        expect(result.reproductionCommandMissing).toBe(true);
    });

    it('should ACCEPT command fix if reproductionCommand passed', async () => {
        const state: any = {
            config: {},
            group: {},
            iteration: 1,
            diagnosis: {
                fixAction: 'command',
                reproductionCommand: 'true' // EXISTS
            },
            files: {},
            feedback: []
        };

        const result = await verificationNode(state, mockContext);

        expect(result.currentNode).toBe('finish');
        expect(result.status).toBe('success');
    });

    it('should REJECT command fix if reproductionCommand failed', async () => {
        const contextWithFail = {
            ...mockContext,
            sandbox: {
                ...mockContext.sandbox,
                runCommand: vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'Error' })
            }
        };

        const state: any = {
            config: {},
            group: {},
            iteration: 1,
            diagnosis: {
                fixAction: 'command',
                reproductionCommand: 'false'
            },
            files: {},
            feedback: []
        };

        const result = await verificationNode(state, contextWithFail);

        expect(result.currentNode).toBe('analysis');
        expect(result.feedback[0]).toContain('Verification Failed');
    });
});
