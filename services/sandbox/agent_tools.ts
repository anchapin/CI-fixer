import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { findUniqueFile } from '../../utils/fileVerification';
import { extractPaths, validatePath, findClosestExistingParent } from '../../utils/pathDetection';
import { GroundingCoordinator } from '../grounding/coordinator';
import { GroundingAction } from '../grounding/types';

/**
 * Agent Tools with Grounding Integration
 * 
 * This module exports file system tools (readFile, writeFile, runCmd) that are wrapped
 * with a "Grounding" layer. This layer intercepts path arguments, verifies their existence
 * using the GroundingCoordinator, and autonomously attempts to correct "hallucinated" paths
 * (e.g., wrong directory, typo) before execution.
 * 
 * Track: fs_grounding_20251228
 */

const execPromise = promisify(exec);

// Cache coordinators by rootDir to avoid re-scanning
const coordinatorCache = new Map<string, GroundingCoordinator>();

function getCoordinator(rootDir: string): GroundingCoordinator {
    if (!coordinatorCache.has(rootDir)) {
        coordinatorCache.set(rootDir, new GroundingCoordinator(rootDir));
    }
    return coordinatorCache.get(rootDir)!;
}

/**
 * Helper function to log path corrections in a parseable format.
 * Uses relative paths from workspace root for clarity.
 */
function logPathCorrection(toolName: string, originalPath: string, correctedPath: string, filename: string): void {
    const rootDir = process.cwd();
    console.log(`[PATH_CORRECTION] ${JSON.stringify({
        tool: toolName,
        originalPath: path.relative(rootDir, originalPath),
        correctedPath: path.relative(rootDir, correctedPath),
        filename,
        timestamp: new Date().toISOString()
    })}`);
}

/**
 * Helper function to log path hallucinations for the main agent to detect loops.
 */
function logPathHallucination(toolName: string, path: string): void {
    console.log(`[PATH_NOT_FOUND] ${JSON.stringify({
        tool: toolName,
        path: path,
        timestamp: new Date().toISOString()
    })}`);
}

/**
 * "Look Before You Leap" helper - verifies file existence and provides helpful error messages.
 * Returns the verified path or throws an error with suggestions.
 * Uses relative paths for clearer LLM feedback.
 */
async function verifyFileExists(
    filePath: string,
    operation: string,
    rootDir: string = process.cwd()
): Promise<{ verifiedPath: string; wasCorrected: boolean; relativePath?: string; error?: string }> {
    const coordinator = getCoordinator(rootDir);

    const result = await coordinator.ground({
        path: filePath,
        action: operation
    });


    if (result.success && result.groundedPath) {
        const absPath = path.resolve(rootDir, result.groundedPath);
        const wasCorrected = result.groundedPath.replace(/\\/g, '/') !== filePath.replace(/\\/g, '/');
        
        return {
            verifiedPath: absPath,
            wasCorrected: wasCorrected,
            relativePath: result.groundedPath
        };
    }

    // If grounding failed, provide detailed error
    logPathHallucination(operation, filePath);
    
    let errorMsg = result.error || `Error: Path NOT FOUND '${filePath}'.`;
    
    // Add some helpful context if it wasn't provided by coordinator
    if (!result.error || !result.error.includes('Found multiple candidates')) {
        const absFilePath = path.resolve(rootDir, filePath);
        const validation = validatePath(absFilePath);
        const parentRelative = path.relative(rootDir, validation.closestParent || '.') || '.';
        errorMsg += `\nClosest existing parent directory: '${parentRelative}'`;
        
        try {
            const dirFiles = fs.readdirSync(path.resolve(rootDir, parentRelative));
            if (dirFiles.length > 0) {
                errorMsg += `\nDirectory listing of '${parentRelative}':\n${dirFiles.map(f => `  - ${f}`).join('\n')}`;
            }
        } catch (dirErr) {
            // Ignore directory read errors
        }
    }

    return {
        verifiedPath: path.resolve(rootDir, filePath),
        wasCorrected: false,
        error: errorMsg
    };
}

/**
 * Reads the content of a file.
 * Uses "Look Before You Leap" verification with helpful error messages.
 */
export async function readFile(filePath: string): Promise<string> {
    try {
        const verification = await verifyFileExists(filePath, 'read');

        if (verification.error) {
            return verification.error;
        }

        if (verification.wasCorrected) {
            logPathCorrection('read_file', filePath, verification.verifiedPath, path.basename(filePath));
        }

        const content = await fs.promises.readFile(verification.verifiedPath, 'utf-8');
        return content;
    } catch (e: any) {
        return `Error reading file ${filePath}: ${e.message}`;
    }
}

/**
 * Writes content to a file. Creates directories if needed.
 * Strips conversational filler if markdown code blocks are detected.
 */
export async function writeFile(filePath: string, content: string): Promise<string> {
    try {
        let targetPath = path.resolve(process.cwd(), filePath);
        
        // [Integration] Verification & Auto-Recovery
        const verification = await verifyFileExists(filePath, 'write');

        if (verification.error) {
            // If it's just "Path NOT FOUND", we can proceed with creation
            // UNLESS it was a directory error.
            if (verification.error.includes('is a directory')) {
                return `Error writing to file ${filePath}: ${verification.error}`;
            }
            
            // If multiple candidates, return the error
            if (verification.error.includes('multiple candidates')) {
                return `Error writing to file ${filePath}: ${verification.error}`;
            }
        }

        if (verification.wasCorrected && verification.verifiedPath) {
            targetPath = verification.verifiedPath;
            logPathCorrection('write_file', filePath, targetPath, path.basename(filePath));
        }

        const fullPath = targetPath;
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

        // Sanitization Layer: Strip conversational filler
        let sanitizedContent = content;
        const startMarker = '```';
        const firstIndex = content.indexOf(startMarker);
        if (firstIndex !== -1) {
            const openingFenceEnd = firstIndex + startMarker.length;
            const closingMarkerIndex = content.indexOf(startMarker, openingFenceEnd);
            if (closingMarkerIndex !== -1) {
                const contentWithInfo = content.substring(openingFenceEnd, closingMarkerIndex);
                const newlineIndex = contentWithInfo.indexOf('\n');
                if (newlineIndex !== -1) {
                    sanitizedContent = contentWithInfo.substring(newlineIndex + 1);
                } else {
                    sanitizedContent = contentWithInfo;
                }
            }
        }

        await fs.promises.writeFile(fullPath, sanitizedContent.trim(), 'utf-8');
        return `Successfully wrote to ${path.relative(process.cwd(), fullPath)}`;
    } catch (e: any) {
        return `Error writing to file ${filePath}: ${e.message}`;
    }
}

/**
 * Executes a shell command and returns output.
 * Uses "Look Before You Leap" verification for file operations (mv, cp, rm).
 */
export async function runCmd(command: string): Promise<string> {
    try {
        let finalCommand = command;
        
        // 1. Extract all potential paths from the command
        const detectedPaths = extractPaths(command);
        
        // 2. Map of original path -> verified/corrected path
        const pathCorrections = new Map<string, string>();

        // 3. Verify each detected path
        for (const filePath of detectedPaths) {
            // We only verify paths that are likely to be inputs (files that should exist)
            // Commands like 'mkdir' or 'touch' might have paths that shouldn't exist yet,
            // but runCmd is primarily used for 'cat', 'rm', 'mv', 'cp', 'ls', etc.
            // For now, we verify all detected paths. If a path is missing and unique match found, we correct it.
            
            // Heuristic: only verify if the command isn't explicitly creating this path
            // (very basic check for now)
            const isCreation = command.trim().startsWith('mkdir') || 
                              (command.trim().startsWith('touch') && detectedPaths.length === 1);
            
            if (!isCreation) {
                const verification = await verifyFileExists(filePath, 'access');
                
                if (verification.error) {
                    // Safety Check for Destructive Commands
                    const cmdLower = command.trim().toLowerCase();
                    const isRm = cmdLower.startsWith('rm ');
                    const isMv = cmdLower.startsWith('mv ');

                    // For 'rm', strictly require the target to exist to avoid hallucinated deletions
                    if (isRm && !verification.error.includes('multiple candidates')) {
                         return `Safety Error: Cannot run '${command}'. Path '${filePath}' does not exist. The agent must verify files (ls/find) before deletion.`;
                    }
                    
                    // If multiple candidates found, block and report
                    if (verification.error.includes('multiple candidates')) {
                        return verification.error;
                    }
                }

                if (verification.wasCorrected && verification.verifiedPath) {
                    pathCorrections.set(filePath, verification.verifiedPath);
                    
                    // Identify the command for better telemetry
                    let specificTool = 'runCmd_auto';
                    const cmdLower = command.trim().toLowerCase();
                    if (cmdLower.startsWith('mv ')) specificTool = 'runCmd_mv';
                    else if (cmdLower.startsWith('rm ')) specificTool = 'runCmd_rm';
                    else if (cmdLower.startsWith('cp ')) specificTool = 'runCmd_cp';
                    else if (cmdLower.startsWith('cat ')) specificTool = 'runCmd_cat';
                    
                    logPathCorrection(specificTool, filePath, verification.verifiedPath, path.basename(filePath));
                }
            }
        }

        // Safety Check for 'mv': At least one path must be valid (the source)
        // If we found NO valid paths for a 'mv' command (and there were detected paths), it's likely a hallucination
        if (command.trim().toLowerCase().startsWith('mv ') && detectedPaths.length > 0) {
             // Check if we have at least one verified existence (either implicitly correct or corrected)
             // We can check if any verification passed (i.e., we didn't return early)
             // But we need to know if any path *actually exists*.
             // detectedPaths contains strings. verifyFileExists was called.
             // We can re-verify or trust the flow.
             // Simpler: If pathCorrections has entries, we found existing files.
             // If NOT, we need to check if any original path exists.
             // BUT verification.error would have triggered for 'rm'. 
             // For 'mv', verification.error happens but we didn't block.
             // We need to verify that at least ONE path exists.
             
             let sourceExists = false;
             for (const p of detectedPaths) {
                 const v = await verifyFileExists(p, 'check');
                 if (!v.error) {
                     sourceExists = true;
                     break;
                 }
             }
             
             if (!sourceExists) {
                 return `Safety Error: Cannot run '${command}'. No specified paths were found. Source file must exist.`;
             }
        }

        // 4. Reconstruct command with corrected paths
        if (pathCorrections.size > 0) {
            // Use regex to split by whitespace OR match quoted strings as single tokens
            const regex = /([^\s"']+|"[^"]*"|'[^']*')|(\s+)/g;
            const tokens: string[] = [];
            let match;
            
            while ((match = regex.exec(finalCommand)) !== null) {
                tokens.push(match[0]);
            }

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (!token.trim()) continue; // Skip whitespace tokens for replacement logic

                // Check for whole token match (with or without quotes)
                const quoteMatch = token.match(/^(['"])(.*)\1$/);
                const unquotedToken = quoteMatch ? quoteMatch[2] : token;

                if (pathCorrections.has(unquotedToken)) {
                    const corrected = pathCorrections.get(unquotedToken)!;
                    const quote = quoteMatch ? quoteMatch[1] : '';
                    tokens[i] = quote ? `${quote}${corrected}${quote}` : corrected;
                }
            }
            finalCommand = tokens.join('');
        }

        const { stdout, stderr } = await execPromise(finalCommand, { timeout: 120000 });
        let output = stdout;
        if (stderr) {
            output += `\n[STDERR]\n${stderr}`;
        }
        return output.trim();
    } catch (e: any) {
        let output = e.stdout || "";
        if (e.stderr) output += `\n[STDERR]\n${e.stderr}`;
        return `Error executing command: ${e.message}\nOutput: ${output}`;
    }
}

/**
 * Searches for a string in files within a directory using grep.
 */
export async function search(query: string, rootDir: string = "."):
 Promise<string[]> {
    try {
        const cmd = `grep -r "${query}" ${rootDir} | head -n 20`;
        const output = await runCmd(cmd);
        if (output.includes("Error executing command")) return [];

        const lines = output.split('\n');
        const matches = lines
            .map(line => line.split(':')[0])
            .filter(p => p && p.trim() !== '')
            // Unique
            .filter((v, i, a) => a.indexOf(v) === i);

        return matches;
    } catch (e) {
        return [];
    }
}

/**
 * Lists files in a directory.
 */
export async function listDir(dirPath: string = "."):
 Promise<string[]> {
    try {
        const fullPath = path.resolve(process.cwd(), dirPath);
        const files = await fs.promises.readdir(fullPath);
        return files;
    } catch (e: any) {
        return [`Error listing directory: ${e.message}`];
    }
}

/**
 * Returns a visual tree structure of the directory.
 */
export async function getFileTree(_startPath: string = ".", maxDepth: number = 2): Promise<string> {
    // Not implementing full recursive walk in TS helper for brevity right now, 
    // can stick to 'find' command if available, or just a simple implementation.
    try {
        const output = await runCmd(`find . -maxdepth ${maxDepth} -not -path '*/.*'`);
        return output;
    } catch (_e) {
        return "Error getting file tree";
    }
}

console.log("Agent Tools (TS) Loaded");