import { describe, it, expect } from 'vitest';
import { extractPaths } from '../../utils/pathDetection';

describe('extractPaths', () => {
    it('should extract simple relative paths', () => {
        const cmd = 'rm src/index.ts';
        expect(extractPaths(cmd)).toContain('src/index.ts');
    });

    it('should extract multiple paths', () => {
        const cmd = 'cp src/main.ts dist/main.js';
        const paths = extractPaths(cmd);
        expect(paths).toContain('src/main.ts');
        expect(paths).toContain('dist/main.js');
    });

    it('should extract paths with dots and dashes', () => {
        const cmd = 'cat ./my-file.test.js';
        expect(extractPaths(cmd)).toContain('./my-file.test.js');
    });

    it('should extract paths with nested directories', () => {
        const cmd = 'ls -la /var/log/syslog';
        expect(extractPaths(cmd)).toContain('/var/log/syslog');
    });

    it('should handle Windows style paths', () => {
        const cmd = 'type .\\src\\app.tsx';
        expect(extractPaths(cmd)).toContain('.\\src\\app.tsx');
    });

    it('should ignore common command flags', () => {
        const cmd = 'rm -rf /tmp/data';
        const paths = extractPaths(cmd);
        expect(paths).toContain('/tmp/data');
        expect(paths).not.toContain('-rf');
    });

    it('should ignore single words without extensions or slashes', () => {
        const cmd = 'git status';
        expect(extractPaths(cmd)).toEqual([]);
    });

    it('should extract paths in quotes', () => {
        const cmd = 'rm "src/space file.ts"';
        expect(extractPaths(cmd)).toContain('src/space file.ts');
    });
});
