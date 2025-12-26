import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterLogs } from '../../services/context-compiler';
import { diagnoseError } from '../../services/analysis/LogAnalysisService';
import { AppConfig } from '../../types';
import * as LLMService from '../../services/llm/LLMService';

// Mock LLMService
vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn((text, fallback) => fallback),
    extractCode: vi.fn(),
    extractCodeBlockStrict: vi.fn(),
}));

describe('Loop Strategy Shift Verification', () => {
    
    describe('Log Filtering', () => {
        it('should preserve LoopDetector warnings in filtered logs', () => {
            const warning = "[LoopDetector] LOOP DETECTED! You MUST change your strategy.";
            // Create a long log to bypass "last 10 lines" fallback
            const padding = Array(50).fill("Info: Standard log line").join('\n');
            const logs = `
            ${padding}
            ${warning}
            ${padding}
            `;

            // Note: The warning does NOT contain "error", "fail", or "exception".
            // This test verifies if filterLogs captures it or if we need to update filterLogs.
            const filtered = filterLogs(logs);
            
            expect(filtered).toContain("LOOP DETECTED");
        });
    });

    describe('Diagnosis Prompt Injection', () => {
        const mockConfig = {} as AppConfig;

        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should include LoopDetector warning in the LLM prompt', async () => {
            const warning = "[LoopDetector] LOOP DETECTED! You MUST change your strategy.";
            const logSnippet = `Error: Something failed\n${warning}`;

            // Mock unifiedGenerate to return a dummy response
            (LLMService.unifiedGenerate as any).mockResolvedValue({ text: "{}" });

            await diagnoseError(mockConfig, logSnippet);

            const generateMock = LLMService.unifiedGenerate as any;
            expect(generateMock).toHaveBeenCalled();

            const callArgs = generateMock.mock.calls[0][1]; // options
            const prompt = callArgs.contents;

            expect(prompt).toContain("LOOP DETECTED");
            expect(prompt).toContain("You MUST change your strategy");
        });
    });
});
