# CI-Fixer Kubernetes-Native Architecture

This directory contains Kubernetes manifests for deploying CI-Fixer with Kubernetes-native sandbox execution.

## Overview

CI-Fixer can now use Kubernetes Jobs as sandbox execution environments instead of Docker containers or E2B microVMs. This provides:

- **Better resource isolation**: Each sandbox runs in its own pod
- **Native Kubernetes integration**: Leverages existing K8s scheduling and resource management
- **Scalability**: Can leverage cluster autoscaling
- **Cost efficiency**: Pay only for resources used during CI fix execution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CI-Fixer Application                      │
│                  (Deployment / Service)                     │
│                    ServiceAccount:                          │
│                    ci-fixer-app                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Creates Jobs via @kubernetes/client-node
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Kubernetes Job #1                          │
│                   (Sandbox Execution)                        │
│                   ServiceAccount:                            │
│                   ci-fixer-sandbox                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Kubernetes Job #2                          │
│                   (Sandbox Execution)                        │
│                   ServiceAccount:                            │
│                   ci-fixer-sandbox                           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install RBAC Resources

```bash
# Apply RBAC manifests (ServiceAccount, Role, RoleBinding)
kubectl apply -f k8s/rbac/k8s.yaml
```

**What this does:**
- Creates `ci-fixer-sandbox` ServiceAccount for sandbox Jobs
- Creates `ci-fixer-app` ServiceAccount for the application
- Creates `ci-fixer-sandbox-manager` Role with permissions to:
  - Create/delete Jobs and Pods
  - Exec into Pods (for running commands)
  - Read Pod logs
- Binds both ServiceAccounts to the Role

### 2. Configure CI-Fixer

Set the execution backend to `kubernetes`:

```typescript
const config: AppConfig = {
  // ... other config
  executionBackend: 'kubernetes',
  dockerImage: 'nikolaik/python-nodejs:python3.11-nodejs20-bullseye', // optional
};
```

Or via environment variable (if implemented):

```bash
export EXECUTION_BACKEND=kubernetes
```

### 3. Deploy CI-Fixer (Optional)

If running CI-Fixer itself in Kubernetes:

```bash
# Create CI-Fixer deployment using the ci-fixer-app ServiceAccount
kubectl apply -f k8s/deployment.yaml
```

## RBAC Permissions

The `ci-fixer-sandbox-manager` Role grants the following permissions:

### Resources and Verbs

| API Group | Resource | Verbs | Purpose |
|-----------|----------|-------|---------|
| `batch` | `jobs` | get, list, watch, create, update, patch, delete | Create and manage sandbox Jobs |
| `` (core) | `pods` | get, list, watch, delete | Monitor and delete sandbox Pods |
| `` (core) | `pods/exec` | create | Execute commands in sandbox Pods |
| `` (core) | `pods/log` | get | Read Pod logs for debugging |
| `` (core) | `configmaps`, `secrets` | get, list, watch, create, update, patch, delete | Future: persistent state storage |

### Security Considerations

- **Namespace-scoped**: Role is scoped to a single namespace (default)
- **No ClusterRoles**: Does not grant cluster-wide permissions
- **Minimal permissions**: Only grants necessary verbs for each resource
- **ServiceAccount isolation**: Sandboxes use a dedicated ServiceAccount

## How It Works

### 1. Job Creation

When CI-Fixer needs to execute code in a sandbox:

```typescript
import { createSandbox } from './sandbox.js';

const sandbox = createSandbox({ executionBackend: 'kubernetes' });
await sandbox.init(); // Creates a Kubernetes Job
```

**What happens:**
1. CI-Fixer calls Kubernetes API to create a Job
2. Job creates a Pod with the sandbox image
3. Pod runs `tail -f /dev/null` to stay alive
4. CI-Fixer waits for Pod to be `Running`

### 2. Command Execution

```typescript
const result = await sandbox.runCommand('ls -la');
```

**What happens:**
1. CI-Fixer opens an exec session to the Pod
2. Command is executed via `/bin/sh -c`
3. Stdout/stderr streams are multiplexed and parsed
4. Result is returned to CI-Fixer

### 3. Cleanup

```typescript
await sandbox.teardown();
```

**What happens:**
1. Job is deleted (with propagationPolicy: Foreground)
2. Pod is automatically deleted due to ownerReferences
3. `ttlSecondsAfterFinished: 300` ensures cleanup even if manual deletion fails

## Monitoring and Debugging

### List CI-Fixer Jobs

```bash
kubectl get jobs -l app=ci-fixer-sandbox
```

### List CI-Fixer Pods

```bash
kubectl get pods -l app=ci-fixer-sandbox
```

### View Logs from a Sandbox Pod

```bash
# Replace <pod-name> with actual pod name
kubectl logs <pod-name>
```

### Exec into a Sandbox Pod (Debugging)

```bash
kubectl exec -it <pod-name> -- /bin/bash
```

### Describe a Failed Job

```bash
kubectl describe job <job-name>
```

## Resource Limits

Default resource limits for sandbox Jobs:

```yaml
resources:
  limits:
    cpu: '1'
    memory: '2Gi'
  requests:
    cpu: '250m'
    memory: '512Mi'
```

These can be customized by modifying the `KubernetesSandbox` class or passing a custom image.

## Customization

### Custom Sandbox Image

```typescript
const sandbox = new KubernetesSandbox(
  'my-custom-sandbox-image:latest', // image
  'my-namespace' // namespace (optional, default: 'default')
);
```

### Custom Namespace

1. Create RBAC resources in your namespace:
   ```bash
   kubectl apply -f k8s/rbac/k8s.yaml -n my-namespace
   ```

2. Update namespace references in the manifests if needed

### Resource Limits

Modify the `resources` field in the Job spec in `sandbox.ts`:

```typescript
resources: {
  limits: {
    cpu: '2',        // Increase CPU limit
    memory: '4Gi'    // Increase memory limit
  },
  requests: {
    cpu: '500m',
    memory: '1Gi'
  }
}
```

## Troubleshooting

### Permission Denied Errors

**Error:** `User "system:serviceaccount:default:ci-fixer-sandbox" cannot create jobs`

**Solution:** Verify RBAC resources are installed:
```bash
kubectl get serviceaccount ci-fixer-sandbox
kubectl get role ci-fixer-sandbox-manager
kubectl get rolebinding ci-fixer-sandbox-binding
```

### Pod Not Starting

**Check:** Pod status and events:
```bash
kubectl describe pod <pod-name>
```

**Common causes:**
- Image not available / pull errors
- Insufficient cluster resources
- ResourceQuota limits

### Exec Failing

**Error:** `Forbidden: user "system:serviceaccount:..." cannot create pods/exec`

**Solution:** Ensure Role includes `pods/exec` permission.

## Cleanup

Remove CI-Fixer sandbox Jobs (manually):
```bash
kubectl delete jobs -l app=ci-fixer-sandbox --all
```

Remove RBAC resources:
```bash
kubectl delete -f k8s/rbac/k8s.yaml
```

## Future Enhancements

- [ ] Add NetworkPolicies for sandbox isolation
- [ ] Implement ResourceQuotas for cost control
- [ ] Add PodDisruptionBudgets for high availability
- [ ] Support for PersistentVolumeClaims for file persistence
- [ ] Metrics and monitoring integration (Prometheus)
- [ ] PodSecurityPolicy replacement (Pod Security Standards)

## References

- [Kubernetes Jobs API](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [@kubernetes/client-node Documentation](https://github.com/kubernetes-client/javascript)
