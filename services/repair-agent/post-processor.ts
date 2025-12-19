
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync, execSync } from 'child_process';

/**
 * Registry of common shell flag typos and their corrections
 */
const SHELL_FLAG_CORRECTIONS = [
    {
        // apt-get --no-install-recommends
        // Handles: --no-installrecommends, --no-install-recommend, --no-installfrrecommends, etc.
        pattern: /--no-install[- ]*(?:fr)?recom+ends?\b/gi,
        replacement: '--no-install-recommends'
    },
    {
        // pip --no-cache-dir
        // Handles: --no-cache, --no-cachedir, --nocache-dir
        pattern: /--no-?cache(?:-?dir)?\b/gi,
        replacement: '--no-cache-dir'
    },
    {
        // npm --no-audit
        pattern: /--noaudit\b/gi,
        replacement: '--no-audit'
    }
];

/**
 * Master post-processor for all generated patches
 */
export function postProcessPatch(filename: string, code: string): string {
    let processed = code;

    // 1. Fix common flag typos (Applied to all files as they might contain shell commands)
    processed = cleanShellFlags(processed);

    // 2. Dockerfile-specific cleaning
    if (isDockerfile(filename)) {
        processed = stripDockerfileInlineComments(processed);
    }

    return processed;
}

/**
 * Helper to identify Dockerfiles
 */
function isDockerfile(filename: string): boolean {
    const f = filename.toLowerCase();
    return f === 'dockerfile' || f.endsWith('.dockerfile') || f.includes('dockerfile.');
}

/**
 * Fixes common typos in shell command flags using a generic pattern registry
 */
function cleanShellFlags(code: string): string {
    let processed = code;

    for (const { pattern, replacement } of SHELL_FLAG_CORRECTIONS) {
        processed = processed.replace(pattern, replacement);
    }

    return processed;
}

/**
 * Removes inline comments in multi-line RUN commands which break Docker builds
 */
function stripDockerfileInlineComments(code: string): string {
    const lines = code.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('#')) {
            const prevLine = i > 0 ? lines[i - 1].trim() : "";
            if (prevLine.endsWith('\\')) {
                // Inline comment inside multi-line command - skip it
                continue;
            }
        }
        resultLines.push(line);
    }

    return resultLines.join('\n');
}

/**
 * Checks spelling in the generated code using cspell
 */
export function checkSpelling(filename: string, code: string): string[] {
    const ext = path.extname(filename) || '.txt';
    const tempFile = path.resolve(process.cwd(), `temp-spell-check-${Date.now()}${ext}`);
    
    try {
        fs.writeFileSync(tempFile, code);
        
        // Try local cspell first, then npx
        const isWin = process.platform === 'win32';
        const cspellName = isWin ? 'cspell.cmd' : 'cspell';
        const localCspell = path.resolve(process.cwd(), 'node_modules', '.bin', cspellName);
        
        let cmd = "";
        if (fs.existsSync(localCspell)) {
            cmd = `"${localCspell}" "${tempFile}" --no-summary --no-progress`;
        } else {
            cmd = `npx cspell "${tempFile}" --no-summary --no-progress`;
        }
        
        try {
            execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            return []; // No errors
        } catch (e: any) {
            const output = (e.stdout || "") + "\n" + (e.stderr || "");
            const lines = output.split('\n');
            
            const errors = lines
                .map((l: string) => {
                    const match = l.match(/Unknown word \((.*?)\)/);
                    return match ? match[1] : null;
                })
                .filter((w: string | null): w is string => !!w);
            
            return [...new Set(errors)];
        }
    } catch (e) {
        console.error('[checkSpelling] Error:', e);
        return [];
    } finally {
        if (fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
        }
    }
}

/**
 * Calculates a confidence penalty based on the number of spelling errors
 */
export function calculateSpellingPenalty(errorCount: number): number {
    const THRESHOLD = 3; // Maximum acceptable spelling errors before penalty increases
    if (errorCount === 0) return 0;
    if (errorCount <= THRESHOLD) return 0.05; // Minor penalty for few errors
    return 0.1 + (errorCount - THRESHOLD) * 0.02; // Steeper penalty for more errors
}
