import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerSandbox } from '../../sandbox';
import { ProvisioningService } from '../../services/sandbox/ProvisioningService';

// Check if Docker is available and the sandbox image exists
async function isDockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('docker info', { stdio: 'pipe' });
    // Check if the ci-fixer-sandbox image exists
    execSync('docker image inspect ci-fixer-sandbox', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

describe('On-Demand Provisioning Integration Test', () => {
  let sandbox: DockerSandbox;
  let provisioning: ProvisioningService;
  let dockerAvailable = false;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log('Skipping: Docker or ci-fixer-sandbox image not available');
      return;
    }
    sandbox = new DockerSandbox('ci-fixer-sandbox');
    await sandbox.init();
    provisioning = new ProvisioningService(sandbox);
  }, 120000);

  afterAll(async () => {
    if (dockerAvailable && sandbox) {
      await sandbox.teardown();
    }
  });

  it('should install a missing runner on demand', async () => {
    if (!dockerAvailable) {
      return; // Skip test if Docker is not available
    }
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
