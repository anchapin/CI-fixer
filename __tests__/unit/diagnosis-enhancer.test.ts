
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enhanceDiagnosisWithFaultLocalization, EnhancedDiagnosis } from '../../services/repair-agent/diagnosis-enhancer';
import { AppConfig } from '../../types';
import { DiagnosisResult } from '../../services/analysis/LogAnalysisService';

// Mock dependencies
const mocks = vi.hoisted(() => ({
    localizeFault: vi.fn(),
    parseStackTrace: vi.fn()
}));

vi.mock('../../services/repair-agent/fault-localization.js', () => ({
    localizeFault: mocks.localizeFault,
    parseStackTrace: mocks.parseStackTrace
}));

describe('Diagnosis Enhancer', () => {
    const mockConfig = {} as AppConfig;
    const mockDiagnosis: DiagnosisResult = {
        type: 'dependency_error',
        summary: 'Error message',
        confidence: 0.9,
        filePath: 'test.ts',
        fixAction: 'edit'
    };

    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should return original diagnosis if feature is disabled', async () => {
        process.env.ENABLE_FAULT_LOCALIZATION = 'false';

        const result = await enhanceDiagnosisWithFaultLocalization(mockConfig, mockDiagnosis, 'error logs');

        expect(result).toBe(mockDiagnosis);
        expect(mocks.parseStackTrace).not.toHaveBeenCalled();
    });

    it('should return original diagnosis if stack trace is empty', async () => {
        process.env.ENABLE_FAULT_LOCALIZATION = 'true';
        mocks.parseStackTrace.mockReturnValue([]);

        const result = await enhanceDiagnosisWithFaultLocalization(mockConfig, mockDiagnosis, 'error logs');

        expect(result).toBe(mockDiagnosis);
        expect(mocks.parseStackTrace).toHaveBeenCalledWith('error logs');
        expect(mocks.localizeFault).not.toHaveBeenCalled();
    });

    it('should return enhanced diagnosis with fault localization', async () => {
        process.env.ENABLE_FAULT_LOCALIZATION = 'true';
        mocks.parseStackTrace.mockReturnValue(['at file.ts:10']);

        const mockLocalization = {
            primaryLocation: {
                file: 'src/file.ts',
                line: 10,
                confidence: 0.8
            }
        };
        mocks.localizeFault.mockResolvedValue(mockLocalization);

        const result = await enhanceDiagnosisWithFaultLocalization(mockConfig, mockDiagnosis, 'error logs', 'repo context');

        expect(mocks.localizeFault).toHaveBeenCalledWith(mockConfig, 'error logs', ['at file.ts:10'], 'repo context');
        expect(result.faultLocalization).toBe(mockLocalization);
        expect(result.preciseLocation).toEqual({
            file: 'src/file.ts',
            line: 10,
            confidence: 0.8
        });
        // Should override filePath because confidence > 0.7
        expect(result.filePath).toBe('src/file.ts');
    });

    it('should not override filePath if confidence is low', async () => {
        const diagnosisWithoutPath = { ...mockDiagnosis, filePath: undefined as any };
        process.env.ENABLE_FAULT_LOCALIZATION = 'true';
        mocks.parseStackTrace.mockReturnValue(['at file.ts:10']);

        const mockLocalization = {
            primaryLocation: {
                file: 'src/file.ts',
                line: 10,
                confidence: 0.5 // Low confidence
            }
        };
        mocks.localizeFault.mockResolvedValue(mockLocalization);

        const result = await enhanceDiagnosisWithFaultLocalization(mockConfig, diagnosisWithoutPath, 'error logs');

        expect(result.faultLocalization).toBe(mockLocalization);
        expect(result.filePath).toBeUndefined(); // Assuming diagnosisWithoutPath didn't have it
    });

    it('should handle errors gracefully and return original diagnosis', async () => {
        process.env.ENABLE_FAULT_LOCALIZATION = 'true';
        mocks.parseStackTrace.mockImplementation(() => { throw new Error('Parse error'); });

        const result = await enhanceDiagnosisWithFaultLocalization(mockConfig, mockDiagnosis, 'error logs');

        expect(result).toBe(mockDiagnosis);
    });
});
