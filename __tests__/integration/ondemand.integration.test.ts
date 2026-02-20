import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerSandbox } from '../../sandbox';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';

describe('On-Demand Provisioning Integration Test', () => {
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

  it('should install a missing runner on demand', async () => {
    // We'll use a tool that is NOT in our base image but is supported by the provisioner mapping
    // Actually, RUNNER_MAPPING only has pytest, vitest, etc. 
    // Let's use 'jest' as it IS in our base image... wait, I want something NOT in base image.
    
    // Let's check if 'playwright' is there (it shouldn't be based on my Dockerfile)
    const initialCheck = await sandbox.runCommand('which playwright');
    expect(initialCheck.exitCode).not.toBe(0);

    // Now attempt to provision it manually via the service
    // I need to add 'playwright' to the mapping or just use provision() directly
    const success = await provisioning.provision('playwright', 'node');
    expect(success).toBe(true);

    const finalCheck = await sandbox.runCommand('playwright --version');
    expect(finalCheck.exitCode).toBe(0);
  }, 300000); // Higher timeout for npm install
});
