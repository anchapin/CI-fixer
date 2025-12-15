
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Reads the content of a file.
 */
export async function readFile(filePath: string): Promise<string> {
    try {
        const fullPath = path.resolve(process.cwd(), filePath);
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        return content;
    } catch (e: any) {
        return `Error reading file ${filePath}: ${e.message}`;
    }
}

/**
 * Writes content to a file. Creates directories if needed.
 */
export async function writeFile(filePath: string, content: string): Promise<string> {
    try {
        const fullPath = path.resolve(process.cwd(), filePath);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, content, 'utf-8');
        return `Successfully wrote to ${filePath}`;
    } catch (e: any) {
        return `Error writing to file ${filePath}: ${e.message}`;
    }
}

/**
 * Executes a shell command and returns output.
 */
export async function runCmd(command: string): Promise<string> {
    try {
        const { stdout, stderr } = await execPromise(command, { timeout: 120000 });
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
export async function search(query: string, rootDir: string = "."): Promise<string[]> {
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
export async function listDir(dirPath: string = "."): Promise<string[]> {
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
export async function getFileTree(startPath: string = ".", maxDepth: number = 2): Promise<string> {
    // Not implementing full recursive walk in TS helper for brevity right now, 
    // can stick to 'find' command if available, or just a simple implementation.
    try {
        const output = await runCmd(`find . -maxdepth ${maxDepth} -not -path '*/.*'`);
        return output;
    } catch (e) {
        return "Error getting file tree";
    }
}

console.log("Agent Tools (TS) Loaded");
