import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerSandbox } from '../../sandbox';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';

describe('Provisioning Persistence Integration', () => {
    let sandbox: DockerSandbox;
    let provisioning: ProvisioningService;

    beforeAll(async () => {
        sandbox = new DockerSandbox('ci-fixer-sandbox');
        await sandbox.init();
        provisioning = new ProvisioningService(sandbox);
    }, 120000);

    afterAll(async () => {
        await sandbox.teardown();
    });

    it('should maintain PATH updates across commands after provisioning', async () => {
        // We use a tool that is NOT pre-installed. 
        // cowsay is a good candidate for this test.
        
        // 1. Verify it's not there
        const { exitCode: initialExit } = await sandbox.runCommand('which cowsay');
        expect(initialExit).not.toBe(0);

        // 2. Provision it
        // We need to manually add cowsay to RUNNER_MAPPING for the test or use a known one.
        // Let's use 'tox' if it wasn't pre-installed, but it is.
        // I will temporarily use a 'python' runtime for cowsay.
        
        console.log("Provisioning cowsay...");
        const success = await provisioning.provision('cowsay', 'python');
        expect(success).toBe(true);

        // 3. Verify it's STILL not in PATH (reproducing the bug)
        const { stdout: afterInstallStdout, exitCode: afterInstallExit } = await sandbox.runCommand('which cowsay');
        expect(afterInstallExit).toBe(0); 
        expect(afterInstallStdout).toContain('/root/.local/bin/cowsay');

        // Also test running the command directly
        const { stdout: cowsayOutput, exitCode: cowsayExitCode } = await sandbox.runCommand('cowsay -t "Hello from ProvisioningService!"');
        expect(cowsayExitCode).toBe(0);
        expect(cowsayOutput).toContain('Hello from ProvisioningService!');
    });
});
