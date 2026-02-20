import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DockerSandbox } from '../../sandbox';

describe('Runners Integration Test', () => {
  let sandbox: DockerSandbox;

  beforeAll(async () => {
    sandbox = new DockerSandbox('ci-fixer-sandbox');
    await sandbox.init();
  }, 120000); // Higher timeout for container startup

  afterAll(async () => {
    await sandbox.teardown();
  });

  it('should have pytest pre-installed', async () => {
    const { stdout, exitCode } = await sandbox.runCommand('pytest --version');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('pytest');
  });

  it('should have vitest pre-installed', async () => {
    const { stdout, exitCode } = await sandbox.runCommand('vitest --version');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('vitest');
  });

  it('should have bun pre-installed', async () => {
    const { exitCode } = await sandbox.runCommand('bun --version');
    expect(exitCode).toBe(0);
  });
});
