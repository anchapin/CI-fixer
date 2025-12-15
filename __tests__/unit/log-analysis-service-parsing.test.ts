import { describe, it, expect, vi, beforeEach } from 'vitest';
import { diagnoseError } from '../../services/analysis/LogAnalysisService.js';
import { AppConfig } from '../../types.js';

// Mock dependencies
vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn(),
    safeJsonParse: vi.fn((text, fallback) => {
        try {
            return JSON.parse(text);
        } catch {
            return fallback;
        }
    }),
    extractCode: vi.fn((text) => text)
}));

vi.mock('../../services/context-compiler.js', () => ({
    filterLogs: vi.fn((logs) => logs),
    summarizeLogs: vi.fn().mockResolvedValue('Log summary')
}));

vi.mock('../../services/sandbox/SandboxService.js', () => ({
    runDevShellCommand: vi.fn()
}));

vi.mock('../../services/llm/prompts.js', () => ({
    generateDiagnosisPrompt: vi.fn().mockReturnValue('mock prompt')
}));

describe('LogAnalysisService - Command Parsing', () => {
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

    const mockLLMResponse = async (suggestedCommand: string) => {
        const { unifiedGenerate } = await import('../../services/llm/LLMService.js');
        vi.mocked(unifiedGenerate).mockResolvedValueOnce({
            text: JSON.stringify({
                summary: 'Test',
                filePath: 'test.ts',
                fixAction: 'command',
                suggestedCommand
            })
        });
    };

    it('should strip "Action: " prefix', async () => {
        await mockLLMResponse('Action: npm install');
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('npm install');
    });

    it('should strip "Command: " prefix', async () => {
        await mockLLMResponse('Command: npm test');
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('npm test');
    });

    it('should strip "Run: " prefix', async () => {
        await mockLLMResponse('Run: rm -rf dist');
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('rm -rf dist');
    });

    it('should strip descriptive prefixes with quotes', async () => {
        await mockLLMResponse("Add cleanup step: 'docker prune'");
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('docker prune');
    });

    it('should strip descriptive prefixes with double quotes', async () => {
        await mockLLMResponse('Install dependencies: "npm install"');
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('npm install');
    });

    it('should remove surrounding quotes from single command', async () => {
        await mockLLMResponse('"npm install"');
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('npm install');
    });

    it('should handle complex natural language instructions', async () => {
        await mockLLMResponse("Create requirements.txt in root: 'pip freeze > requirements.txt'");
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe('pip freeze > requirements.txt');
    });

    it('should preserve valid commands that look like descriptions but aren\'t', async () => {
        // e.g. "echo 'Hello: World'" - should not be stripped incorrectly
        // Our heuristic checks for spaces in prefix. "echo" has no spaces.
        await mockLLMResponse("echo 'Hello: world'");
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe("echo 'Hello: world'");
    });

    it('should preserve commands with colons naturally', async () => {
        await mockLLMResponse("scp file user@host:/path");
        const result = await diagnoseError(mockConfig, 'Error');
        expect(result.suggestedCommand).toBe("scp file user@host:/path");
    });
});
