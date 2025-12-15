
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { runRepairAgent, isRepairAgentEnabled, getRepairAgentConfig } from '../../../../services/repair-agent/orchestrator.js';
import { AppConfig } from '../../../../types.js';
import { SandboxEnvironment } from '../../../../sandbox.js';

// Mocks
vi.mock('../../../../services/repair-agent/fault-localization.js', () => ({
    parseStackTrace: vi.fn(),
    localizeFault: vi.fn(),
}));

vi.mock('../../../../services/repair-agent/patch-generation.js', () => ({
    generatePatchCandidates: vi.fn(),
}));

vi.mock('../../../../services/repair-agent/patch-validation.js', () => ({
    validatePatches: vi.fn(),
}));

vi.mock('../../../../services/repair-agent/patch-ranking.js', () => ({
    rankPatchesByCriteria: vi.fn(),
    getBestPatch: vi.fn(),
}));

vi.mock('../../../../services/repair-agent/feedback-loop.js', () => ({
    iterativeRefinement: vi.fn(),
}));

import { parseStackTrace, localizeFault } from '../../../../services/repair-agent/fault-localization.js';
import { generatePatchCandidates } from '../../../../services/repair-agent/patch-generation.js';
import { validatePatches } from '../../../../services/repair-agent/patch-validation.js';
import { rankPatchesByCriteria, getBestPatch } from '../../../../services/repair-agent/patch-ranking.js';
import { iterativeRefinement } from '../../../../services/repair-agent/feedback-loop.js';


describe('RepairAgent Orchestrator', () => {
    let mockConfig: AppConfig;
    let mockSandbox: SandboxEnvironment;

    beforeEach(() => {
        vi.clearAllMocks();

        mockConfig = {} as AppConfig;
        mockSandbox = { runCommand: vi.fn() } as unknown as SandboxEnvironment;

        // Default implementation mocks
        (parseStackTrace as Mock).mockReturnValue([{ file: 'main.ts', line: 10 }]);
        (localizeFault as Mock).mockResolvedValue({ primaryLocation: { file: 'main.ts', line: 10 } });
        (generatePatchCandidates as Mock).mockResolvedValue({
            candidates: [{ id: 'patch-1', code: 'fixed' }],
            primaryCandidate: { id: 'patch-1', code: 'fixed' }
        });
        (validatePatches as Mock).mockResolvedValue(new Map([['patch-1', { passed: true }]]));
        (rankPatchesByCriteria as Mock).mockReturnValue([{ id: 'patch-1', score: 1.0 }]);
        (getBestPatch as Mock).mockReturnValue({ id: 'patch-1', code: 'fixed' });
    });

    it('should run full repair cycle successfully', async () => {
        const result = await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test'
        );

        expect(result.success).toBe(true);
        expect(result.finalPatch).toBe('fixed');
        expect(localizeFault).toHaveBeenCalled();
        expect(generatePatchCandidates).toHaveBeenCalled();
        expect(validatePatches).toHaveBeenCalled();
        expect(rankPatchesByCriteria).toHaveBeenCalled();
    });

    it('should skip fault localization if disabled', async () => {
        await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test',
            undefined,
            { enableFaultLocalization: false }
        );

        expect(parseStackTrace).not.toHaveBeenCalled();
        expect(localizeFault).not.toHaveBeenCalled();
    });

    it('should handle validation failure and attempt refinement', async () => {
        // Validation fails initially
        (validatePatches as Mock).mockResolvedValue(new Map([['patch-1', { passed: false }]]));
        // Refinement succeeds
        (iterativeRefinement as Mock).mockResolvedValue({
            finalPatch: { id: 'patch-refined', code: 'refined' },
            validationResult: { passed: true },
            iterations: 1
        });

        const result = await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test',
            undefined,
            { enableIterativeRefinement: true }
        );

        expect(result.success).toBe(true);
        expect(result.finalPatch).toBe('refined');
        expect(iterativeRefinement).toHaveBeenCalled();
    });

    it('should skip validation if disabled', async () => {
        await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test',
            undefined,
            { enableValidation: false }
        );

        expect(validatePatches).not.toHaveBeenCalled();
    });

    it('should handle valid environment variable configs', () => {
        process.env.ENABLE_REPAIR_AGENT = 'true';
        expect(isRepairAgentEnabled()).toBe(true);

        process.env.MAX_PATCH_CANDIDATES = '5';
        const config = getRepairAgentConfig();
        expect(config.maxCandidates).toBe(5);

        // Cleanup
        delete process.env.ENABLE_REPAIR_AGENT;
        delete process.env.MAX_PATCH_CANDIDATES;
    });

    it('should handle errors during fault localization gracefully', async () => {
        (localizeFault as Mock).mockRejectedValue(new Error('Localization failed'));

        const result = await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test'
        );

        expect(result.success).toBe(false);
        expect(result.finalPatch).toBe('original'); // Fallback
    });

    it('should handle zero candidates from patch generation', async () => {
        (generatePatchCandidates as Mock).mockResolvedValue({
            candidates: [],
            primaryCandidate: { id: 'fallback', code: 'fallback' }
        });
        (rankPatchesByCriteria as Mock).mockReturnValue([]);
        (getBestPatch as Mock).mockReturnValue(undefined);

        const result = await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test'
        );

        expect(result.success).toBe(false);
        expect(result.rankedPatches).toHaveLength(0);
    });

    it('should handle validation execution errors (e.g. sandbox crash)', async () => {
        (validatePatches as Mock).mockRejectedValue(new Error('Sandbox crash'));

        const result = await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test'
        );

        expect(result.success).toBe(false);
        expect(result.finalPatch).toBe('original');
    });

    it('should not refine if no best patch is selected (empty candidates)', async () => {
        (generatePatchCandidates as Mock).mockResolvedValue({
            candidates: [],
            primaryCandidate: { id: 'fallback', code: 'fallback' }
        });

        await runRepairAgent(
            mockConfig,
            'Error Log',
            'original',
            'Error Message',
            mockSandbox,
            'npm test',
            undefined,
            { enableIterativeRefinement: true }
        );

        expect(iterativeRefinement).not.toHaveBeenCalled();
    });
    it('should skip fault localization if disabled', async () => {
        const result = await runRepairAgent(mockConfig, 'Error', 'code', 'msg', mockSandbox, 'cmd', undefined, { enableFaultLocalization: false });
        expect(result.faultLocalization).toBeUndefined();
        expect(parseStackTrace).not.toHaveBeenCalled();
    });

    it('should handle missing stack trace', async () => {
        (parseStackTrace as Mock).mockReturnValue([]);
        const result = await runRepairAgent(mockConfig, 'Error', 'code', 'msg', mockSandbox, 'cmd');
        expect(localizeFault).not.toHaveBeenCalled();
        // Should fallback to default location
    });
});
