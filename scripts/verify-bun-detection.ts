import { BunDetector } from '../services/analysis/BunDetector';
import { BunErrorPattern } from '../services/analysis/BunErrorPattern';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

async function main() {
    console.log("=== Verifying Bun Detection & Diagnostics ===");

    // 1. Check current directory (Node)
    console.log("\n1. Checking current project (should be Node)...");
    const isBun = await BunDetector.isBunProject(process.cwd());
    console.log(`Is Bun Project: ${isBun} ${!isBun ? '✅ (Correct)' : '❌ (Unexpected)'}`);

    // 2. Check temporary Bun setup
    console.log("\n2. Checking mock Bun project...");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bun-check-'));
    try {
        await fs.writeFile(path.join(tempDir, 'bun.lockb'), 'lock-content');
        const isMockBun = await BunDetector.isBunProject(tempDir);
        console.log(`Is Mock Bun Project: ${isMockBun} ${isMockBun ? '✅ (Correct)' : '❌ (Unexpected)'}`);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }

    // 3. Check Error Pattern
    console.log("\n3. Checking Error Pattern Recognition...");
    const sampleError = 'Error: Cannot bundle built-in module "bun:test"';
    const diagnosis = BunErrorPattern.diagnose(sampleError);
    console.log(`Error: "${sampleError}"`);
    console.log(`Diagnosed as Bun Error: ${diagnosis.isBunError} ${diagnosis.isBunError ? '✅ (Correct)' : '❌ (Unexpected)'}`);
    if (diagnosis.description) {
        console.log(`Description: ${diagnosis.description}`);
    }

    console.log("\n=== Verification Complete ===");
}

main().catch(console.error);
