#!/usr/bin/env tsx
/**
 * Validation Test for Kubernetes-Native Sandbox Architecture
 *
 * This script validates that:
 * 1. Dockerfile exists and is multi-stage
 * 2. docker-compose.yml exists with health checks
 * 3. Kubernetes manifests exist (RBAC, Deployment)
 * 4. KubernetesSandbox class is implemented
 * 5. @kubernetes/client-node dependency is present
 */

import { readFileSync, existsSync } from 'fs';
import { parse } from 'toml'; // Use YAML parser instead
import * as yaml from 'js-yaml';

interface ValidationResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  details: string;
}

const results: ValidationResult[] = [];

function test(check: string, condition: boolean, details: string) {
  results.push({
    check,
    status: condition ? 'PASS' : 'FAIL',
    details
  });
}

console.log('=== Validating Kubernetes-Native Sandbox Architecture ===\n');

// Test 1: Dockerfile exists and is multi-stage
console.log('Test 1: Checking Dockerfile...');
if (existsSync('Dockerfile')) {
  const dockerfile = readFileSync('Dockerfile', 'utf-8');
  const hasMultiStage = dockerfile.includes('AS builder') && dockerfile.includes('AS runner');
  const hasPrisma = dockerfile.includes('npx prisma generate');
  const hasHealthCheck = dockerfile.includes('HEALTHCHECK');

  test('Dockerfile exists', true, 'File found');
  test('Multi-stage build', hasMultiStage, hasMultiStage ? 'Has builder and runner stages' : 'Missing stages');
  test('Prisma generation', hasPrisma, hasPrisma ? 'Generates Prisma client' : 'Missing Prisma step');
  test('Health check', hasHealthCheck, hasHealthCheck ? 'Has HEALTHCHECK directive' : 'Missing health check');
} else {
  test('Dockerfile exists', false, 'File not found');
}

// Test 2: docker-compose.yml exists with health checks
console.log('\nTest 2: Checking docker-compose.yml...');
if (existsSync('docker-compose.yml')) {
  const composeContent = readFileSync('docker-compose.yml', 'utf-8');
  const compose: any = yaml.load(composeContent);

  const hasDbService = compose.services?.db !== undefined;
  const hasAppService = compose.services?.app !== undefined;
  const hasDbHealthCheck = compose.services?.db?.healthcheck !== undefined;
  const hasAppHealthCheck = compose.services?.app?.healthcheck !== undefined;
  const hasDependency = compose.services?.app?.depends_on?.db?.condition !== undefined;

  test('docker-compose.yml exists', true, 'File found');
  test('Database service', hasDbService, hasDbService ? 'PostgreSQL service defined' : 'Missing db service');
  test('App service', hasAppService, hasAppService ? 'Application service defined' : 'Missing app service');
  test('DB health check', hasDbHealthCheck, hasDbHealthCheck ? 'DB has health check' : 'Missing DB health check');
  test('App health check', hasAppHealthCheck, hasAppHealthCheck ? 'App has health check' : 'Missing app health check');
  test('Service dependency', hasDependency, hasDependency ? 'App depends on healthy DB' : 'Missing dependency');
} else {
  test('docker-compose.yml exists', false, 'File not found');
}

// Test 3: K8s RBAC manifests exist
console.log('\nTest 3: Checking K8s RBAC manifests...');
const rbacFiles = [
  'k8s/rbac/serviceaccount.yaml',
  'k8s/rbac/role.yaml',
  'k8s/rbac/rolebinding.yaml',
  'k8s/rbac/k8s.yaml'
];

let rbacCount = 0;
rbacFiles.forEach(file => {
  if (existsSync(file)) {
    rbacCount++;
    test(`RBAC: ${file}`, true, 'File exists');
  } else {
    test(`RBAC: ${file}`, false, 'File not found');
  }
});

// Test 4: K8s Deployment manifest exists
console.log('\nTest 4: Checking K8s Deployment manifest...');
if (existsSync('k8s/deployment/deployment.yaml')) {
  const deployContent = readFileSync('k8s/deployment/deployment.yaml', 'utf-8');
  const hasServiceAccount = deployContent.includes('serviceAccountName: ci-fixer-app');
  const hasEnvBackend = deployContent.includes('EXECUTION_BACKEND');
  const hasLivenessProbe = deployContent.includes('livenessProbe');
  const hasReadinessProbe = deployContent.includes('readinessProbe');

  test('Deployment manifest', true, 'File exists');
  test('ServiceAccount binding', hasServiceAccount, hasServiceAccount ? 'Uses ci-fixer-app SA' : 'Missing SA');
  test('Execution backend env', hasEnvBackend, hasEnvBackend ? 'Has EXECUTION_BACKEND env var' : 'Missing env var');
  test('Liveness probe', hasLivenessProbe, hasLivenessProbe ? 'Has livenessProbe' : 'Missing liveness probe');
  test('Readiness probe', hasReadinessProbe, hasReadinessProbe ? 'Has readinessProbe' : 'Missing readiness probe');
} else {
  test('Deployment manifest', false, 'File not found');
}

// Test 5: KubernetesSandbox class implementation
console.log('\nTest 5: Checking KubernetesSandbox implementation...');
if (existsSync('sandbox.ts')) {
  const sandboxContent = readFileSync('sandbox.ts', 'utf-8');
  const hasKubernetesImport = sandboxContent.includes("from '@kubernetes/client-node'");
  const hasKubernetesSandboxClass = sandboxContent.includes('class KubernetesSandbox');
  const hasBatchApi = sandboxContent.includes('BatchV1Api');
  const hasCoreApi = sandboxContent.includes('CoreV1Api');
  const hasSpawnMethod = sandboxContent.includes('async spawnSandbox');

  test('Kubernetes import', hasKubernetesImport, hasKubernetesImport ? 'Imports @kubernetes/client-node' : 'Missing import');
  test('KubernetesSandbox class', hasKubernetesSandboxClass, hasKubernetesSandboxClass ? 'Class defined' : 'Missing class');
  test('Batch API usage', hasBatchApi, hasBatchApi ? 'Uses BatchV1Api for Jobs' : 'Missing Batch API');
  test('Core API usage', hasCoreApi, hasCoreApi ? 'Uses CoreV1Api for Pods' : 'Missing Core API');
  test('Spawn method', hasSpawnMethod, hasSpawnMethod ? 'Has spawn/execution method' : 'Missing spawn method');
} else {
  test('sandbox.ts exists', false, 'File not found');
}

// Test 6: @kubernetes/client-node dependency
console.log('\nTest 6: Checking @kubernetes/client-node dependency...');
if (existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  const hasK8sDep = pkg.dependencies?.['@kubernetes/client-node'] !== undefined;

  test('@kubernetes/client-node dep', hasK8sDep, hasK8sDep ? 'Dependency present' : 'Missing dependency');
} else {
  test('package.json exists', false, 'File not found');
}

// Summary
console.log('\n=== Validation Summary ===');
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
const total = results.length;

results.forEach(result => {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${result.check}: ${result.details}`);
});

console.log(`\nTotal: ${passed}/${total} passed`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('\n✅ All validation tests passed!');
  process.exit(0);
}
