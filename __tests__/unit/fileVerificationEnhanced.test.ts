import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findUniqueFile } from '../../utils/fileVerification';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { glob } from 'tinyglobby';
import * as path from 'node:path';

vi.mock('node:fs');
vi.mock('node:child_process');
vi.mock('tinyglobby');

describe('findUniqueFile (Enhanced)', () => {
    const mockRootDir = '/test/project';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should use fuzzy search when exact match and glob fail', async () => {
        // Mock fs.existsSync to fail
        vi.mocked(fs.existsSync).mockReturnValue(false);
        
        // Mock glob to return nothing
        vi.mocked(glob).mockResolvedValue([]);

        // Mock git ls-files
        const mockFiles = [
            'src/index.ts',
            'src/components/Button.tsx',
            'utils/helper.ts'
        ];
        vi.mocked(execSync).mockReturnValue(mockFiles.join('\n') as any);

        // Search for something close to 'utils/helper.ts'
        const result = await findUniqueFile('utils/helpr.ts', mockRootDir);

        expect(result.found).toBe(true);
        expect(result.path).toContain(path.normalize('utils/helper.ts'));
    });

    it('should return multiple candidates when fuzzy search is ambiguous', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(glob).mockResolvedValue([]);
        
        const mockFiles = [
            'src/Button.tsx',
            'src/Button.test.tsx'
        ];
        vi.mocked(execSync).mockReturnValue(mockFiles.join('\n') as any);

        const result = await findUniqueFile('Buton.tsx', mockRootDir);

        expect(result.found).toBe(false);
        expect(result.matches.length).toBe(2);
    });
});
