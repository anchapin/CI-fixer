#!/usr/bin/env tsx
/**
 * Kubernetes-Native Deployment Verification Script
 */

import { KubeConfig, CoreV1Api, BatchV1Api, RbacAuthorizationV1Api, AppsV1Api } from '@kubernetes/client-node';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  details: string;
}

const results: TestResult[] = [];

function test(name: string, condition: boolean, details: string) {
  results.push({ name, status: condition ? 'PASS' : 'FAIL', details });
  console.log(`${condition ? '✅' : '❌'} ${name}: ${details}`);
}

async function runTests() {
  console.log('=== Kubernetes-Native Deployment Verification ===\n');

  const kc = new KubeConfig();
  try {
    kc.loadFromDefault();
  } catch (e) {
    test('KubeConfig Load', false, 'Failed to load Kubernetes config');
    console.error('\n⚠️  Make sure kubectl is configured and you have cluster access');
    process.exit(1);
  }
  test('KubeConfig Load', true, 'Kubernetes config loaded');

  const k8sApi = kc.makeApiClient(CoreV1Api);
  const batchApi = kc.makeApiClient(BatchV1Api);
  const rbacApi = kc.makeApiClient(RbacAuthorizationV1Api);
  const appsApi = kc.makeApiClient(AppsV1Api);

  const namespace = 'default';

  // Test ServiceAccounts
  console.log('\n--- ServiceAccounts ---');
  try {
    await k8sApi.readNamespacedServiceAccount('ci-fixer-app', namespace);
    test('ci-fixer-app ServiceAccount', true, 'Exists');
  } catch (e: any) {
    test('ci-fixer-app ServiceAccount', false, 'Not found - run: kubectl apply -f k8s/rbac/k8s.yaml');
  }

  try {
    await k8sApi.readNamespacedServiceAccount('ci-fixer-sandbox', namespace);
    test('ci-fixer-sandbox ServiceAccount', true, 'Exists');
  } catch (e: any) {
    test('ci-fixer-sandbox ServiceAccount', false, 'Not found - run: kubectl apply -f k8s/rbac/k8s.yaml');
  }

  // Test Role
  console.log('\n--- RBAC Role ---');
  try {
    const role = await rbacApi.readNamespacedRole('ci-fixer-sandbox-manager', namespace);
    test('ci-fixer-sandbox-manager Role', true, 'Exists');

    const rules = role.body.rules || [];
    const hasJobsRule = rules.some(r => r.apiGroups?.includes('batch') && r.resources?.includes('jobs'));
    const hasPodsRule = rules.some(r => r.apiGroups?.includes('') && r.resources?.includes('pods'));
    const hasPodExecRule = rules.some(r => r.apiGroups?.includes('') && r.resources?.includes('pods/exec'));

    test('Jobs permissions', hasJobsRule, hasJobsRule ? '✓' : 'Missing');
    test('Pods permissions', hasPodsRule, hasPodsRule ? '✓' : 'Missing');
    test('Pod exec permissions', hasPodExecRule, hasPodExecRule ? '✓' : 'Missing');
  } catch (e: any) {
    test('ci-fixer-sandbox-manager Role', false, 'Not found - run: kubectl apply -f k8s/rbac/k8s.yaml');
  }

  // Summary
  console.log('\n=== Summary ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${passed}/${results.length} passed`);

  if (failed > 0) {
    console.log(`\n⚠️  ${failed} test(s) failed`);
    console.log('\nApply RBAC resources:');
    console.log('  kubectl apply -f k8s/rbac/k8s.yaml');
    process.exit(1);
  } else {
    console.log('\n✅ All verification tests passed!');
    console.log('\nNext steps:');
    console.log('  1. Deploy CI-fixer app: kubectl apply -f k8s/deployment/deployment.yaml');
    console.log('  2. Test Job spawning');
    console.log('  3. Verify RBAC permissions');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
