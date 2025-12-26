import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReproductionInferenceService } from '../../services/reproduction-inference';
import * as fs from 'fs/promises';
import { unifiedGenerate, safeJsonParse } from '../../services/llm/LLMService';
import { AppConfig } from '../../types';

vi.mock('fs/promises');
vi.mock('../../services/llm/LLMService');

describe('ReproductionInferenceService - Agent Retry', () => {
  let service: ReproductionInferenceService;
  const mockRepoPath = '/mock/repo';
  const mockConfig: AppConfig = {
    githubToken: 'test-token',
    repoUrl: 'https://github.com/test/repo',
    selectedRuns: [],
    devEnv: 'simulation',
    checkEnv: 'simulation'
  };

  beforeEach(() => {
    // ReproductionInferenceService now takes config
    service = new ReproductionInferenceService(mockConfig);
    vi.clearAllMocks();
    vi.mocked(fs.stat).mockRejectedValue(new Error('File not found'));
    vi.mocked(fs.readdir).mockResolvedValue(['manage.py', 'requirements.txt', 'app/'] as any);
    
    // Default mock for safeJsonParse to just JSON.parse
    vi.mocked(safeJsonParse).mockImplementation((text, fallback) => {
      try {
        return JSON.parse(text);
      } catch {
        return fallback;
      }
    });
  });

  it('should infer command using Agent Retry when other strategies fail', async () => {
    vi.mocked(unifiedGenerate).mockResolvedValue({
      text: '{"command": "python manage.py test", "reasoning": "Detected Django project structure"}',
      metrics: { tokensInput: 0, tokensOutput: 0, cost: 0, latency: 0, model: 'test' }
    });

    const result = await service.inferCommand(mockRepoPath);
    
    expect(result).not.toBeNull();
    expect(result?.command).toBe('python manage.py test');
    expect(result?.strategy).toBe('agent_retry');
    expect(result?.reasoning).toContain('Django');
    expect(unifiedGenerate).toHaveBeenCalled();
  });
});
