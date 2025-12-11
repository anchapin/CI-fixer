
import { Sandbox } from '@e2b/code-interpreter';
import * as fs from 'fs';
import * as path from 'path';

console.log("=== E2B Connection Diagnostic Script ===");
console.log(`Node Version: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}`);

// Simple .env parser since we don't have dotenv installed
const envPath = path.resolve(process.cwd(), '.env.local');
let apiKey = process.env.E2B_API_KEY;

if (fs.existsSync(envPath)) {
    console.log(`Loading .env.local from ${envPath}`);
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^"|"$/g, '');
            process.env[key] = value;
            if (key === 'E2B_API_KEY') apiKey = value;
        }
    });
} else {
    console.log("No .env.local found. Relying on process.env");
}

if (!apiKey) {
    console.error("ERROR: E2B_API_KEY not found in environment or .env.local");
    process.exit(1);
}

console.log(`API Key present: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);

// Check Fetch
if (typeof fetch === 'undefined') {
    console.error("CRITICAL: 'fetch' is not defined. You are likely on an old Node version (<18).");
    console.log("Please install 'cross-fetch' or upgrade Node.js.");
} else {
    console.log("'fetch' is available natively.");
}

async function runDiagnosis() {
    console.log("\nAttempting to create Sandbox...");
    const start = Date.now();
    try {
        const sandbox = await Sandbox.create({
            apiKey: apiKey,
            timeoutMs: 30000 // 30s timeout
        });
        const duration = Date.now() - start;
        console.log(`\nSUCCESS: Sandbox created in ${duration}ms`);
        console.log(`Sandbox ID: ${sandbox.sandboxId}`);

        console.log("Running trivial command...");
        const result = await sandbox.runCode("echo 'Hello E2B'");
        console.log("Command Output:", result.logs.stdout.join(''));

        await sandbox.kill();
        console.log("Sandbox killed. Test Passed.");
    } catch (e: any) {
        const duration = Date.now() - start;
        console.error(`\nFAILURE after ${duration}ms`);
        console.error("Error Name:", e.name);
        console.error("Error Message:", e.message);

        if (e.cause) {
            console.error("Cause:", e.cause);
        }

        if (e.message.includes('Failed to fetch')) {
            console.error("\nANALYSIS: 'Failed to fetch' usually means:");
            console.error("1. DNS Resolution failure (api.e2b.dev)");
            console.error("2. Firewall / Proxy blocking connections");
            console.error("3. Node.js 'fetch' incompatibility");

            // Try a raw fetch to debug network
            console.log("\nTrying raw fetch to https://api.e2b.dev/health ...");
            try {
                const health = await fetch('https://api.e2b.dev/health');
                console.log(`Raw fetch status: ${health.status} ${health.statusText}`);
            } catch (fetchErr: any) {
                console.error("Raw fetch failed:", fetchErr.message);
                if (fetchErr.cause) console.error("Raw fetch cause:", fetchErr.cause);
            }
        }
    }
}

runDiagnosis();
