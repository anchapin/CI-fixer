import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { codingNode } from '../../agent/graph/nodes/execution';
import { GraphState, GraphContext } from '../../agent/graph/state';
import { SandboxEnvironment } from '../../sandbox';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Path Verification Integration (read_file)', () => {
    let tempDir: string;
    let mockSandbox: any;
    let context: any;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-verify-integration-'));
        
        mockSandbox = {
            readFile: vi.fn(async (p) => {
                const fullPath = path.isAbsolute(p) ? p : path.join(tempDir, p);
                if (fs.existsSync(fullPath)) {
                    return fs.readFileSync(fullPath, 'utf-8');
                }
                throw new Error(`File not found: ${p}`);
            }),
            writeFile: vi.fn(),
            runCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
            getWorkDir: () => tempDir
        };

        context = {
            sandbox: mockSandbox,
            logCallback: vi.fn(),
            services: {
                analysis: {
                    generateFix: vi.fn(async () => 'fixed code')
                },
                sandbox: {
                    toolLintCheck: vi.fn(async () => ({ valid: true }))
                },
                context: {
                    markNodeSolved: vi.fn((state) => ({ solvedNodes: ['node1'] }))
                },
                discovery: {
                    findUniqueFile: vi.fn(async (filename, rootDir) => {
                        const basename = path.basename(filename);
                        const pattern = `**/${basename}`;
                        const { glob } = await import('tinyglobby');
                        const matches = (await glob(pattern, { cwd: rootDir, absolute: true, ignore: ['**/node_modules/**'] })).map(p => path.normalize(p));
                        
                        if (matches.length === 1) return { found: true, path: matches[0], matches };
                        return { found: false, matches };
                    })
                }
            },
            dbClient: {
                fileModification: {
                    create: vi.fn()
                }
            }
        };
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should automatically correct hallucinated path in execution node', async () => {
        // Setup: file exists in src/app.ts, but diagnosis says app.ts
        const srcDir = path.join(tempDir, 'src');
        fs.mkdirSync(srcDir);
        const realPath = path.join(srcDir, 'app.ts');
        fs.writeFileSync(realPath, 'original content');

        const state: any = {
            config: {},
            group: { id: 'run1' },
            diagnosis: {
                summary: 'Fix bug',
                filePath: 'app.ts', // Hallucinated (missing 'src/')
                fixAction: 'edit'
            },
            files: {},
            fileReservations: [],
            feedback: []
        };

        const result = await codingNode(state, context);
        
        expect(result.activeFileChange?.path).toBe('src/app.ts');
        expect(context.logCallback).toHaveBeenCalledWith('SUCCESS', expect.stringContaining('Auto-corrected path'));
    });

    it('should abort and return feedback if multiple matches are found', async () => {
        const dir1 = path.join(tempDir, 'src');
        const dir2 = path.join(tempDir, 'lib');
        fs.mkdirSync(dir1);
        fs.mkdirSync(dir2);
        fs.writeFileSync(path.join(dir1, 'utils.ts'), 'content 1');
        fs.writeFileSync(path.join(dir2, 'utils.ts'), 'content 2');

        const state: any = {
            config: {},
            group: { id: 'run1' },
            diagnosis: {
                summary: 'Fix bug',
                filePath: 'utils.ts',
                fixAction: 'edit'
            },
            files: {},
            fileReservations: [],
            feedback: []
        };

        const result = await codingNode(state, context);
        
        expect(result.currentNode).toBe('analysis');
        expect(result.feedback[0]).toContain('Path Hallucination: Multiple files named \'utils.ts\' found');
        expect(context.logCallback).toHaveBeenCalledWith('WARN', expect.stringContaining('Multiple matches found'));
    });
});
