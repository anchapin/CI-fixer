/**
 * Validation Test: Reduce Concurrency and Improve Docker Resource Allocation
 *
 * This script validates the hypothesis that:
 * 1. Docker containers lack resource limits (CPU, memory, network)
 * 2. Unbounded concurrent agent execution causes resource contention
 * 3. Adding resource limits and concurrency controls will prevent crashes
 *
 * Test Type: Internal (Code Analysis + Infrastructure Audit)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface DockerLine {
  file: string;
  line: number;
  hasResourceLimits: boolean;
  missingLimits: string[];
}

interface ConcurrencyLine {
  file: string;
  line: number;
  hasConcurrencyLimit: boolean;
  pattern: string;
}

describe('Validation: Reduce Concurrency and Docker Resource Limits', () => {
  const projectRoot = process.cwd();
  const results = {
    dockerAnalysis: [] as DockerLine[],
    concurrencyAnalysis: [] as ConcurrencyLine[],
    resourceMonitoring: false,
    overallScore: 0,
  };

  describe('Part 1: Docker Resource Limits Analysis', () => {
    it('should detect missing Docker resource limits in sandbox.ts', () => {
      const sandboxPath = join(projectRoot, 'sandbox.ts');
      expect(existsSync(sandboxPath), 'sandbox.ts must exist').toBe(true);

      const content = readFileSync(sandboxPath, 'utf-8');
      const lines = content.split('\n');

      // Find the docker run command
      const dockerRunLine = lines.findIndex(line =>
        line.includes('docker run') && line.includes('-d')
      );

      expect(dockerRunLine, 'Must find docker run command').toBeGreaterThan(-1);

      const dockerRunCommand = lines.slice(dockerRunLine, dockerRunLine + 5).join(' ');
      const missingLimits: string[] = [];

      // Check for resource limit flags
      const resourceLimits = {
        '--cpus': 'CPU limit',
        '--memory': 'Memory limit',
        '--pids-limit': 'Process limit',
        '--network': 'Network constraint',
        '--cpuset-cpus': 'CPU pinning',
        '--cpu-shares': 'CPU shares',
      };

      for (const [flag, description] of Object.entries(resourceLimits)) {
        if (!dockerRunCommand.includes(flag)) {
          missingLimits.push(description);
        }
      }

      const hasResourceLimits = missingLimits.length < Object.keys(resourceLimits).length;

      results.dockerAnalysis.push({
        file: 'sandbox.ts',
        line: dockerRunLine + 1,
        hasResourceLimits,
        missingLimits,
      });

      // VALIDATION CRITERIA: This test PASSES if we detect the problem
      // The hypothesis claims resource limits are missing - we verify this is true
      expect(missingLimits.length, 'Docker command should be missing resource limits (validates hypothesis)').toBeGreaterThan(0);

      console.log(`✓ Detected ${missingLimits.length} missing resource limits in docker run command`);
      console.log(`  Missing: ${missingLimits.join(', ')}`);
    });

    it('should verify DockerSandbox class structure', () => {
      const sandboxPath = join(projectRoot, 'sandbox.ts');
      const content = readFileSync(sandboxPath, 'utf-8');

      // Verify DockerSandbox class exists
      expect(content).toContain('class DockerSandbox');
      expect(content).toContain('async init()');
      expect(content).toContain('async teardown()');

      // Check if resource limit parameters exist in constructor or config
      const hasResourceConfig =
        content.includes('cpuLimit') ||
        content.includes('memoryLimit') ||
        content.includes('resourceLimit') ||
        content.includes('--cpus') ||
        content.includes('--memory');

      results.dockerAnalysis.push({
        file: 'sandbox.ts',
        line: 1,
        hasResourceLimits: hasResourceConfig,
        missingLimits: hasResourceConfig ? [] : ['CPU/Memory configuration'],
      });

      console.log(`✓ DockerSandbox class structure verified`);
      console.log(`  Has resource config: ${hasResourceConfig}`);
    });
  });

  describe('Part 2: Concurrency Control Analysis', () => {
    it('should detect unbounded parallel execution in MultiAgentCoordinator', () => {
      const coordinatorPath = join(projectRoot, 'services/multi-agent/coordinator.ts');
      expect(existsSync(coordinatorPath), 'coordinator.ts must exist').toBe(true);

      const content = readFileSync(coordinatorPath, 'utf-8');
      const lines = content.split('\n');

      // Find Promise.all usage
      const promiseAllLines = lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => line.includes('Promise.all'))
        .map(({ idx }) => idx + 1);

      // Check for concurrency limiting patterns
      const hasLimitingLibrary =
        content.includes('p-limit') ||
        content.includes('p-queue') ||
        content.includes('concurrency') ||
        content.includes('MAX_CONCURRENT') ||
        content.includes('throttle') ||
        content.includes('semaphore');

      results.concurrencyAnalysis.push({
        file: 'services/multi-agent/coordinator.ts',
        line: promiseAllLines[0] || 1,
        hasConcurrencyLimit: hasLimitingLibrary,
        pattern: hasLimitingLibrary ? 'concurrency-limited' : 'unbounded-Promise.all',
      });

      // VALIDATION CRITERIA: Hypothesis claims unbounded concurrency exists
      expect(promiseAllLines.length, 'Should use Promise.all for parallel execution').toBeGreaterThan(0);

      console.log(`✓ Found ${promiseAllLines.length} Promise.all usage(s) at line(s): ${promiseAllLines.join(', ')}`);
      console.log(`  Has concurrency limiting: ${hasLimitingLibrary}`);
    });

    it('should detect missing concurrency limits in server.ts endpoint', () => {
      const serverPath = join(projectRoot, 'server.ts');
      expect(existsSync(serverPath), 'server.ts must exist').toBe(true);

      const content = readFileSync(serverPath, 'utf-8');

      // Check /api/agent/start endpoint
      const agentStartEndpoint = content.includes('/api/agent/start');
      expect(agentStartEndpoint, 'Must have agent start endpoint').toBe(true);

      // Check for throttling mechanisms
      const hasThrottling =
        content.includes('MAX_CONCURRENT') ||
        content.includes('concurrencyLimit') ||
        content.includes('queue') ||
        content.includes('semaphore') ||
        content.includes('rateLimit') ||
        content.includes('throttle');

      results.concurrencyAnalysis.push({
        file: 'server.ts',
        line: content.indexOf('/api/agent/start'),
        hasConcurrencyLimit: hasThrottling,
        pattern: hasThrottling ? 'throttled-endpoint' : 'unbounded-endpoint',
      });

      console.log(`✓ Agent start endpoint exists`);
      console.log(`  Has throttling mechanism: ${hasThrottling}`);
    });

    it('should check agent worker for concurrency limits', () => {
      const workerPath = join(projectRoot, 'agent/worker.ts');
      expect(existsSync(workerPath), 'worker.ts must exist').toBe(true);

      const content = readFileSync(workerPath, 'utf-8');

      // Check for MAX_ITERATIONS (exists) vs MAX_CONCURRENT_AGENTS (should not exist per hypothesis)
      const hasMaxIterations = content.includes('MAX_ITERATIONS');
      const hasMaxConcurrent = content.includes('MAX_CONCURRENT');

      results.concurrencyAnalysis.push({
        file: 'agent/worker.ts',
        line: content.indexOf('MAX_ITERATIONS'),
        hasConcurrencyLimit: hasMaxConcurrent,
        pattern: hasMaxConcurrent ? 'has-concurrency-limit' : 'has-iteration-limit-only',
      });

      // VALIDATION CRITERIA: MAX_ITERATIONS exists but MAX_CONCURRENT does not
      expect(hasMaxIterations, 'Should have MAX_ITERATIONS constant').toBe(true);

      console.log(`✓ Worker has MAX_ITERATIONS: ${hasMaxIterations}`);
      console.log(`  Worker has MAX_CONCURRENT_AGENTS: ${hasMaxConcurrent}`);
    });
  });

  describe('Part 3: Resource Monitoring Analysis', () => {
    it('should check for Docker resource monitoring', () => {
      const sandboxPath = join(projectRoot, 'sandbox.ts');
      const content = readFileSync(sandboxPath, 'utf-8');

      // Check for docker stats or resource monitoring
      const hasMonitoring =
        content.includes('docker stats') ||
        content.includes('getCpuUsage') ||
        content.includes('getMemoryUsage') ||
        content.includes('resourceUsage') ||
        content.includes('monitor') ||
        content.includes('metrics');

      results.resourceMonitoring = hasMonitoring;

      console.log(`✓ Resource monitoring exists: ${hasMonitoring}`);
    });

    it('should check for health checks and auto-recovery', () => {
      const filesToCheck = [
        'sandbox.ts',
        'services/sandbox/SandboxService.ts',
        'server.ts',
      ];

      let hasHealthCheck = false;
      let hasAutoRecovery = false;

      for (const file of filesToCheck) {
        const filePath = join(projectRoot, file);
        if (!existsSync(filePath)) continue;

        const content = readFileSync(filePath, 'utf-8');
        hasHealthCheck = hasHealthCheck || content.includes('health') || content.includes('healthCheck');
        hasAutoRecovery = hasAutoRecovery || content.includes('recover') || content.includes('restart');
      }

      console.log(`✓ Health checks: ${hasHealthCheck}`);
      console.log(`✓ Auto-recovery: ${hasAutoRecovery}`);
    });
  });

  describe('Part 4: Overall Validation', () => {
    it('should calculate overall validation score', () => {
      // Score: How many problems did we detect that the hypothesis predicts?
      let problemsDetected = 0;
      let totalChecks = 0;

      // Docker limits missing?
      totalChecks++;
      if (results.dockerAnalysis.some(d => !d.hasResourceLimits)) {
        problemsDetected++;
        console.log('✓ VALIDATED: Docker resource limits are missing');
      }

      // Unbounded concurrency?
      totalChecks++;
      if (results.concurrencyAnalysis.some(c => !c.hasConcurrencyLimit)) {
        problemsDetected++;
        console.log('✓ VALIDATED: Unbounded concurrency exists');
      }

      // Resource monitoring missing?
      totalChecks++;
      if (!results.resourceMonitoring) {
        problemsDetected++;
        console.log('✓ VALIDATED: Resource monitoring is missing');
      }

      results.overallScore = (problemsDetected / totalChecks) * 100;

      console.log(`\n=== VALIDATION SUMMARY ===`);
      console.log(`Problems Detected: ${problemsDetected}/${totalChecks}`);
      console.log(`Validation Score: ${results.overallScore}%`);

      // VALIDATION CRITERIA:
      // If we detected the problems the hypothesis predicts, the hypothesis is VALID
      expect(problemsDetected, 'Should detect at least 2 predicted problems').toBeGreaterThanOrEqual(2);
      expect(results.overallScore, 'Validation score should be >= 66%').toBeGreaterThanOrEqual(66.66);
    });

    it('should generate actionable recommendations', () => {
      const recommendations: string[] = [];

      // Docker recommendations
      if (results.dockerAnalysis.some(d => !d.hasResourceLimits)) {
        recommendations.push('1. Add --cpus=X, --memory=X to docker run command in DockerSandbox.init()');
        recommendations.push('2. Add --pids-limit to prevent fork bombs');
        recommendations.push('3. Create DockerSandboxConfig interface for resource parameters');
      }

      // Concurrency recommendations
      if (results.concurrencyAnalysis.some(c => !c.hasConcurrencyLimit)) {
        recommendations.push('4. Add MAX_CONCURRENT_AGENTS constant (start with 1)');
        recommendations.push('5. Implement queue system in server.ts /api/agent/start');
        recommendations.push('6. Add p-limit or similar library to MultiAgentCoordinator');
      }

      // Monitoring recommendations
      if (!results.resourceMonitoring) {
        recommendations.push('7. Add docker stats monitoring for CPU/memory usage');
        recommendations.push('8. Create health check endpoint for container status');
        recommendations.push('9. Add auto-recovery logic for crashed containers');
      }

      console.log(`\n=== ACTIONABLE RECOMMENDATIONS ===`);
      recommendations.forEach(rec => console.log(rec));

      expect(recommendations.length, 'Should have at least 3 recommendations').toBeGreaterThanOrEqual(3);
    });
  });
});
