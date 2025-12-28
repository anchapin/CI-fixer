import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LanguageScopingService } from '../../services/LanguageScopingService.js';
import { LanguageScope } from '../../types.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('LanguageScopingService', () => {
  let service: LanguageScopingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LanguageScopingService();
  });

  describe('detectScope', () => {
    it('should detect JS_TS scope based on keywords (vitest)', async () => {
      const logs = 'Error: vitest failed with exit code 1';
      // Mock package.json existence
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.JS_TS);
    });

    it('should detect Python scope based on keywords (pytest)', async () => {
      const logs = 'E ImportError: No module named pytest';
      // Mock requirements.txt existence
      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path.toString().includes('requirements.txt')) return undefined;
        throw new Error('ENOENT');
      });

      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.PYTHON);
    });

    it('should detect Go scope based on keywords (go test)', async () => {
      const logs = 'go test ./... failed';
      // Mock go.mod existence
      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path.toString().includes('go.mod')) return undefined;
        throw new Error('ENOENT');
      });

      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.GO);
    });

    it('should detect Generic scope for system errors (docker)', async () => {
      const logs = 'docker build failed: connection refused';
      
      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.GENERIC);
    });

    it('should fallback to Generic if no keywords match', async () => {
      const logs = 'Unknown error occurred';
      
      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.GENERIC);
    });

    it('should prioritize keyword match over manifest if multiple are present', async () => {
      // Snippet has JS keywords but we are in a polyglot repo
      const logs = 'npm ERR! vitest failed';
      vi.mocked(fs.access).mockResolvedValue(undefined); // All manifests exist

      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.JS_TS);
    });

    it('should use manifest if keywords are ambiguous but manifest is clear', async () => {
      const logs = 'Error: build failed';
      vi.mocked(fs.access).mockImplementation(async (path) => {
        if (path.toString().includes('requirements.txt')) return undefined;
        throw new Error('ENOENT');
      });

      const scope = await service.detectScope(logs, '/app');
      expect(scope).toBe(LanguageScope.PYTHON);
    });
  });
});
