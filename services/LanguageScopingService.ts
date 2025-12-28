import * as fs from 'fs/promises';
import * as path from 'path';
import { LanguageScope, ScopingRules } from '../types.js';

const SCOPING_RULES: ScopingRules = {
  [LanguageScope.JS_TS]: {
    keywords: ['npm', 'yarn', 'vitest', 'jest', 'mocha', 'tsc', 'node', 'bun'],
    manifests: ['package.json', 'tsconfig.json', 'package-lock.json', 'bun.lockb']
  },
  [LanguageScope.PYTHON]: {
    keywords: ['pytest', 'pip', 'python', 'tox', 'ImportError', 'ModuleNotFoundError', 'pip3'],
    manifests: ['requirements.txt', 'pyproject.toml', 'setup.py', 'environment.yml']
  },
  [LanguageScope.GO]: {
    keywords: ['go', 'go test', 'golang'],
    manifests: ['go.mod', 'go.sum']
  },
  [LanguageScope.GENERIC]: {
    keywords: ['docker', 'github/workflows', 'bash', 'sh', 'make'],
    manifests: []
  }
};

export class LanguageScopingService {
  /**
   * Detects the language scope of an error based on logs and project manifests.
   * Priority:
   * 1. Specific language keywords in logs
   * 2. Generic system keywords in logs
   * 3. Presence of language-specific manifest files
   * @param logs The error log snippet to analyze
   * @param workingDir The directory to check for manifest files
   */
  async detectScope(logs: string, workingDir: string): Promise<LanguageScope> {
    // 1. Keyword Matching (Specific Languages)
    const specificScopes = [LanguageScope.JS_TS, LanguageScope.PYTHON, LanguageScope.GO];
    for (const scope of specificScopes) {
      const rules = SCOPING_RULES[scope];
      for (const keyword of rules.keywords) {
        if (logs.includes(keyword)) {
          return scope;
        }
      }
    }

    // 2. Keyword Matching (Generic)
    for (const keyword of SCOPING_RULES[LanguageScope.GENERIC].keywords) {
      if (logs.includes(keyword)) {
        return LanguageScope.GENERIC;
      }
    }

    // 3. Manifest Validation
    for (const scope of specificScopes) {
      const rules = SCOPING_RULES[scope];
      for (const manifest of rules.manifests) {
        try {
          await fs.access(path.join(workingDir, manifest));
          return scope;
        } catch {
          // Continue to next manifest
        }
      }
    }

    return LanguageScope.GENERIC;
  }
}
