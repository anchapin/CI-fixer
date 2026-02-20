import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerSandbox } from '../../sandbox';

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

describe('Runners Integration Test', () => {
  let sandbox: DockerSandbox;
  let dockerAvailable = false;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log('Skipping: Docker or ci-fixer-sandbox image not available');
      return;
    }
    sandbox = new DockerSandbox('ci-fixer-sandbox');
    await sandbox.init();
  }, 120000); // Higher timeout for container startup

  afterAll(async () => {
    if (dockerAvailable && sandbox) {
      await sandbox.teardown();
    }
  });

  it('should have pytest pre-installed', async () => {
    if (!dockerAvailable) {
      return; // Skip test if Docker is not available
    }
    const { stdout, exitCode } = await sandbox.runCommand('pytest --version');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('pytest');
  });

  it('should have vitest pre-installed', async () => {
    if (!dockerAvailable) {
      return; // Skip test if Docker is not available
    }
    const { stdout, exitCode } = await sandbox.runCommand('vitest --version');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('vitest');
  });

  it('should have bun pre-installed', async () => {
    if (!dockerAvailable) {
      return; // Skip test if Docker is not available
    }
    const { exitCode } = await sandbox.runCommand('bun --version');
    expect(exitCode).toBe(0);
  });
});
