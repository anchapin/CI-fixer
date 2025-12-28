/**
 * Integration Test: Realistic Hallucination Scenario with Telemetry
 *
 * This test simulates a realistic scenario where an AI agent hallucinates
 * file paths and verifies that:
 * 1. The path verification system auto-corrects the paths
 * 2. Telemetry logs are emitted for corrections
 * 3. The agent successfully completes its task despite hallucinations
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock child_process for runCmd tests
vi.mock('child_process', () => {
    return {
        exec: vi.fn((cmd, opts, cb) => {
            const callback = typeof opts === 'function' ? opts : cb;
            if (callback) callback(null, { stdout: 'success', stderr: '' });
            return {};
        })
    };
});

import { readFile, writeFile, runCmd } from '../../services/sandbox/agent_tools';
import { collectPathCorrections, extractPathCorrections } from '../../services/telemetry/PathCorrectionCollector';

describe('Hallucination Scenario with Telemetry', () => {
    let tempDir: string;
    let originalCwd: string;
    let consoleLogSpy: any;

    beforeAll(() => {
        originalCwd = process.cwd();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hallucination-test-'));
        process.chdir(tempDir);

        // Setup realistic project structure
        fs.mkdirSync(path.join(tempDir, 'src', 'components'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'src', 'utils'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });

        // Create realistic files
        fs.writeFileSync(
            path.join(tempDir, 'src', 'components', 'Button.tsx'),
            `export const Button = () => <button>Click me</button>;`
        );
        fs.writeFileSync(
            path.join(tempDir, 'src', 'utils', 'helpers.ts'),
            `export const formatDate = (date: Date) => date.toISOString();`
        );
        fs.writeFileSync(
            path.join(tempDir, 'tests', 'Button.test.tsx'),
            `describe('Button', () => { it('renders', () => {}); });`
        );
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        // Spy on console.log to capture telemetry output
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
    });

    describe('Scenario 1: Agent hallucinates component file path', () => {
        it('should auto-correct and log telemetry when reading component', async () => {
            // Agent thinks file is at root but it's in src/components/
            const hallucinatedPath = 'Button.tsx';
            const content = await readFile(hallucinatedPath);

            // Verify correct content was retrieved
            expect(content).toContain('export const Button');
            expect(content).toContain('Click me');

            // Verify telemetry was logged
            const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
            expect(logCalls).toContain('[PATH_CORRECTION]');

            // Verify we can parse the telemetry
            const corrections = extractPathCorrections(logCalls);
            expect(corrections).toHaveLength(1);
            expect(corrections[0]).toMatchObject({
                tool: 'read_file',
                originalPath: 'Button.tsx',
                filename: 'Button.tsx',
            });
            expect(corrections[0].correctedPath).toContain('src');
        });
    });

    describe('Scenario 2: Agent hallucinates utility file path for editing', () => {
        it('should auto-correct and log telemetry when writing to utility', async () => {
            // Agent thinks file is at src/helpers.ts but it's in src/utils/
            const hallucinatedPath = 'src/helpers.ts';
            const result = await writeFile(hallucinatedPath, 'export const foo = "bar";');

            // Verify write succeeded
            expect(result).toContain('Successfully wrote to');

            // Verify the actual file was updated
            const actualContent = fs.readFileSync(
                path.join(tempDir, 'src', 'utils', 'helpers.ts'),
                'utf-8'
            );
            expect(actualContent).toContain('export const foo = "bar"');

            // Restore original content
            fs.writeFileSync(
                path.join(tempDir, 'src', 'utils', 'helpers.ts'),
                `export const formatDate = (date: Date) => date.toISOString();`
            );

            // Verify telemetry was logged
            const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
            const corrections = extractPathCorrections(logCalls);
            expect(corrections.length).toBeGreaterThan(0);
            expect(corrections[0].tool).toBe('write_file');
        });
    });

    describe('Scenario 3: Agent hallucinates path in shell command', () => {
        it('should auto-correct and log telemetry for mv command', async () => {
            // Agent tries to move a file from wrong location
            const hallucinatedPath = 'components/Button.tsx';
            await runCmd(`mv ${hallucinatedPath} /tmp/backup.tsx`);

            // Verify telemetry was logged
            const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
            expect(logCalls).toContain('[PATH_CORRECTION]');

            const corrections = extractPathCorrections(logCalls);
            const mvCorrections = corrections.filter(c => c.tool === 'runCmd_mv');
            expect(mvCorrections.length).toBeGreaterThan(0);
            // Path separator varies by OS, check for either forward or backward slash
            expect(mvCorrections[0].correctedPath).toMatch(/src[/\\]components/);
        });

        it('should auto-correct and log telemetry for rm command', async () => {
            // Agent tries to delete test file from wrong location
            const hallucinatedPath = 'Button.test.tsx';
            await runCmd(`rm ${hallucinatedPath}`);

            // Verify telemetry was logged
            const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
            const corrections = extractPathCorrections(logCalls);
            const rmCorrections = corrections.filter(c => c.tool === 'runCmd_rm');
            expect(rmCorrections.length).toBeGreaterThan(0);
            expect(rmCorrections[0].correctedPath).toContain('tests');

            // Restore the test file
            fs.writeFileSync(
                path.join(tempDir, 'tests', 'Button.test.tsx'),
                `describe('Button', () => { it('renders', () => {}); });`
            );
        });
    });

    describe('Scenario 4: Multiple hallucinations in a workflow', () => {
        it('should track all corrections in a single workflow', async () => {
            consoleLogSpy.mockClear();

            // Simulate a realistic workflow with multiple hallucinations
            await readFile('Button.tsx');
            await writeFile('helpers.ts', 'new content');
            await runCmd('mv components/Button.tsx /tmp/backup.tsx');

            // Restore the moved file
            fs.writeFileSync(
                path.join(tempDir, 'src', 'components', 'Button.tsx'),
                `export const Button = () => <button>Click me</button>;`
            );
            fs.writeFileSync(
                path.join(tempDir, 'src', 'utils', 'helpers.ts'),
                `export const formatDate = (date: Date) => date.toISOString();`
            );

            // Verify multiple corrections were logged
            const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
            const corrections = extractPathCorrections(logCalls);

            expect(corrections.length).toBeGreaterThanOrEqual(2);

            // Verify each correction has required fields
            corrections.forEach(correction => {
                expect(correction).toHaveProperty('tool');
                expect(correction).toHaveProperty('originalPath');
                expect(correction).toHaveProperty('correctedPath');
                expect(correction).toHaveProperty('filename');
                expect(correction).toHaveProperty('timestamp');
            });

            // Verify tools logged
            const tools = corrections.map(c => c.tool);
            expect(tools).toContain('read_file');
            expect(tools.some(t => t.startsWith('runCmd_'))).toBe(true);
        });
    });

    describe('Telemetry Parsing', () => {
        it('should correctly parse path correction from complex output', () => {
            const mockOutput = `
[Sandbox] Executing: npm test
[PATH_CORRECTION] {"tool":"read_file","originalPath":"Button.tsx","correctedPath":"C:\\\\proj\\\\src\\\\components\\\\Button.tsx","filename":"Button.tsx","timestamp":"2025-12-22T10:00:00.000Z"}
Test passed successfully
[PATH_CORRECTION] {"tool":"write_file","originalPath":"utils.ts","correctedPath":"C:\\\\proj\\\\src\\\\utils\\\\helpers.ts","filename":"helpers.ts","timestamp":"2025-12-22T10:00:05.000Z"}
            `.trim();

            const corrections = extractPathCorrections(mockOutput);

            expect(corrections).toHaveLength(2);
            expect(corrections[0].tool).toBe('read_file');
            expect(corrections[0].originalPath).toBe('Button.tsx');
            expect(corrections[1].tool).toBe('write_file');
            expect(corrections[1].originalPath).toBe('utils.ts');
        });
    });
});
