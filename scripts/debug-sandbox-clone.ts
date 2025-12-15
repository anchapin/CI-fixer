
import { prepareSandbox } from '../services/sandbox/SandboxService';
import { AppConfig } from '../types';

async function main() {
    console.log("Starting Sandbox Clone Debug...");

    const config: AppConfig = {
        githubToken: "mock-token",
        executionBackend: 'docker_local',
        dockerImage: 'node:20-bullseye', // Match prod
        port: 3000,
        webhookSecret: 'test',
        privateKeyPath: 'test.pem',
        appId: '123'
    } as any;

    // Use the actual repo that has pnpm
    const repoUrl = "anchapin/ModPorter-AI";

    try {
        console.log(`Calling prepareSandbox with ${repoUrl}...`);
        const sandbox = await prepareSandbox(config, repoUrl);

        console.log("Sandbox prepared successfully!");

        console.log("DEBUG: Listing root files...");
        const lsRoot = await sandbox.runCommand("ls -la");
        console.log(lsRoot.stdout);


        // check if pnpm is installed
        console.log("Verifying pnpm installation...");
        const pnpmCheck = await sandbox.runCommand("pnpm --version");
        console.log("pnpm --version:", pnpmCheck.stdout);

        if (pnpmCheck.exitCode === 0) {
            console.log("SUCCESS: pnpm is installed.");
        } else {
            console.error("FAILURE: pnpm is NOT installed.");
            process.exit(1);
        }

        console.log("Verifying .git existence...");

        const check = await sandbox.runCommand("ls -la .git");
        console.log("Check Output:", check.stdout);

        if (check.exitCode === 0 && check.stdout.includes('HEAD')) {
            console.log("SUCCESS: .git directory exists and is valid.");
        } else {
            console.error("FAILURE: .git directory validation failed.");
            process.exit(1);
        }

        await sandbox.teardown();

    } catch (e: any) {
        console.error("Caught Error:", e);
        process.exit(1);
    }
}

main();
