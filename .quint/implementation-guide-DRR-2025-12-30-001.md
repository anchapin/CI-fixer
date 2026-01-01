# Implementation Guide: Kubernetes-Native CI-Fixer

**Decision Record:** DRR-2025-12-30-001
**Date:** 2025-12-30
**Status:** ✅ APPROVED - READY FOR IMPLEMENTATION

---

## Quick Start

### Prerequisites

1. **Kubernetes Cluster** (local or cloud)
   - Minikube (local): `minikube start`
   - Docker Desktop (local): Enable Kubernetes
   - Cloud cluster: AWS EKS, GCP GKE, Azure AKS

2. **kubectl configured**
   ```bash
   kubectl cluster-info
   kubectl get nodes
   ```

3. **Node.js dependencies installed**
   ```bash
   npm install
   ```

---

## Phase 1: Kubernetes-Native Architecture

### Step 1: Apply RBAC Resources

**Why first?** ServiceAccounts and Roles must exist before deploying the app.

```bash
# Apply all RBAC resources
kubectl apply -f k8s/rbac/k8s.yaml

# Verify
kubectl get serviceaccount ci-fixer-app
kubectl get serviceaccount ci-fixer-sandbox
kubectl get role ci-fixer-sandbox-manager
kubectl get rolebinding ci-fixer-sandbox-binding
```

**Expected Output:**
```
serviceaccount/ci-fixer-app created
serviceaccount/ci-fixer-sandbox created
role.rbac.authorization.k8s.io/ci-fixer-sandbox-manager created
rolebinding.rbac.authorization.k8s.io/ci-fixer-sandbox-binding created
```

---

### Step 2: Verify RBAC Installation

Run the verification script:

```bash
npx tsx scripts/verify-k8s-deployment.ts
```

**Expected:** All ServiceAccounts and Roles verified ✅

---

### Step 3: Build Docker Image

**For local development:**

```bash
# Build image
docker build -t ci-fixer:latest .

# If using Minikube, load image into Minikube
minikube image load ci-fixer:latest
```

**For cloud deployment:**

```bash
# Tag for your registry
docker tag ci-fixer:latest <your-registry>/ci-fixer:latest

# Push to registry
docker push <your-registry>/ci-fixer:latest
```

---

### Step 4: Deploy Application

**Option A: Using existing manifest (local):**

```bash
kubectl apply -f k8s/deployment/deployment.yaml

# Verify deployment
kubectl get deployment ci-fixer-app
kubectl get pods -l app=ci-fixer
```

**Option B: Using Helm (after Phase 2):**

```bash
# Install via Helm
helm install ci-fixer ./chart

# Verify
helm list
kubectl get pods -l app.kubernetes.io/instance=ci-fixer
```

---

### Step 5: Verify Deployment

```bash
# Check pod status
kubectl get pods -l app=ci-fixer

# Check pod logs
kubectl logs -l app=ci-fixer --tail=50

# Port forward to access app
kubectl port-forward deployment/ci-fixer-app 3000:3001

# Access in browser
open http://localhost:3000
```

**Expected:** Pods are `Running` and ready ✅

---

## Phase 2: Testing Job Spawning

### Step 1: Test KubernetesSandbox Class

Create a test script `scripts/test-k8s-sandbox.ts`:

```typescript
import { KubernetesSandbox } from '../sandbox.js';

async function testJobSpawning() {
  console.log('Testing Kubernetes Job spawning...');

  const sandbox = new KubernetesSandbox(
    'nikolaik/python-nodejs:python3.11-nodejs20-bullseye',
    'default'
  );

  try {
    // Initialize (creates Job)
    await sandbox.init();
    console.log('✅ Job created successfully');

    // Run command
    const result = await sandbox.runCommand('echo "Hello from K8s sandbox!"');
    console.log('✅ Command executed:', result.stdout);

    // Cleanup
    await sandbox.teardown();
    console.log('✅ Job deleted successfully');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testJobSpawning();
```

Run the test:

```bash
npx tsx scripts/test-k8s-sandbox.ts
```

**Expected:**
- ✅ Job created
- ✅ Command executed
- ✅ Job deleted

---

### Step 2: Verify Job Lifecycle

```bash
# Watch jobs being created
kubectl get jobs -l app=ci-fixer-sandbox -w

# Watch pods being created
kubectl get pods -l app=ci-fixer-sandbox -w

# Describe a job
kubectl describe job <job-name>

# View pod logs
kubectl logs <pod-name>
```

**Expected Behavior:**
1. Job is created with `ttlSecondsAfterFinished: 300`
2. Pod is spawned and runs to completion
3. Pod is automatically deleted after 5 minutes
4. Job is deleted when sandbox.teardown() is called

---

### Step 3: Verify RBAC Permissions

**Test that CI-fixer can create Jobs:**

```bash
# Check ServiceAccount permissions
kubectl auth can-i create jobs --as=system:serviceaccount:default:ci-fixer-app

# Expected: yes
```

**Test that CI-fixer CANNOT do cluster-wide damage:**

```bash
# Should fail (least privilege)
kubectl auth can-i delete nodes --as=system:serviceaccount:default:ci-fixer-app

# Expected: no
```

**Expected:** CI-fixer has Job permissions but NOT cluster-wide permissions ✅

---

## Phase 3: Helm Chart Creation (After K8s Validation)

### Step 1: Create Chart Structure

```bash
# Create chart directory
mkdir -p chart/templates

# Create Chart.yaml
cat > chart/Chart.yaml << 'EOF'
apiVersion: v2
name: ci-fixer
description: CI-Fixer - Kubernetes-native CI fix automation
type: application
version: 0.1.0
appVersion: "1.0.0"
EOF
```

### Step 2: Create Values Files

**values.yaml (Minikube defaults):**

```yaml
# Default values for Minikube/local deployment

replicaCount: 1

image:
  repository: ci-fixer
  pullPolicy: IfNotPresent
  tag: "latest"

service:
  type: ClusterIP
  port: 80

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi

# Sandbox configuration
sandbox:
  image: "nikolaik/python-nodejs:python3.11-nodejs20-bullseye"
  resources:
    limits:
      cpu: 500m
      memory: 1Gi
    requests:
      cpu: 100m
      memory: 256Mi

# Node selector for Minikube
nodeSelector: {}

tolerations: []

affinity: {}
```

**values-prod.yaml (Production overrides):**

```yaml
# Production overrides for cloud deployment

replicaCount: 2

image:
  repository: <your-registry>/ci-fixer
  pullPolicy: Always

service:
  type: LoadBalancer

resources:
  limits:
    cpu: 2000m
    memory: 4Gi
  requests:
    cpu: 500m
    memory: 1Gi

sandbox:
  image: "nikolaik/python-nodejs:python3.11-nodejs20-bullseye"
  resources:
    limits:
      cpu: 1000m
      memory: 2Gi
    requests:
      cpu: 250m
      memory: 512Mi

# Enable GPU support if needed
gpu:
  enabled: false
  # nvidia.com/gpu: 1
```

### Step 3: Create Helm Templates

Wrap existing K8s manifests in Helm templates:

```bash
# Copy existing manifests into chart/templates
cp k8s/rbac/serviceaccount.yaml chart/templates/
cp k8s/rbac/role.yaml chart/templates/
cp k8s/rbac/rolebinding.yaml chart/templates/
cp k8s/deployment/deployment.yaml chart/templates/deployment.yaml
cp k8s/deployment/deployment.yaml | grep -A 20 'kind: Service' > chart/templates/service.yaml
```

### Step 4: Test Helm Deployment

```bash
# Dry-run to verify chart
helm install ci-fixer ./chart --dry-run --debug

# Install to cluster
helm install ci-fixer ./chart

# Verify
helm list
kubectl get pods -l app.kubernetes.io/instance=ci-fixer

# Test upgrade
helm upgrade ci-fixer ./chart

# Test rollback
helm rollback ci-fixer 1

# Uninstall (when done)
helm uninstall ci-fixer
```

---

## Troubleshooting

### Issue: "ServiceAccount not found"

**Solution:**
```bash
kubectl apply -f k8s/rbac/k8s.yaml
```

### Issue: "Permission denied" when creating Jobs

**Solution:**
```bash
# Verify RoleBinding
kubectl get rolebinding ci-fixer-sandbox-binding -o yaml

# Check if ServiceAccount is bound
kubectl describe rolebinding ci-fixer-sandbox-binding
```

### Issue: Pod stuck in "ImagePullBackOff"

**Solution:**
```bash
# For Minikube, load image
minikube image load ci-fixer:latest

# For cloud, check image registry
kubectl get pods -l app=ci-fixer
kubectl describe pod <pod-name>
```

### Issue: Jobs not being cleaned up

**Solution:**
```bash
# Check Job spec for ttlSecondsAfterFinished
kubectl get job <job-name> -o yaml | grep ttlSecondsAfterFinished

# Manual cleanup
kubectl delete jobs -l app=ci-fixer-sandbox --all
```

---

## Validation Checklist

Before moving to production, verify:

- [ ] RBAC resources applied
- [ ] ServiceAccounts exist
- [ ] Role has least-privilege permissions
- [ ] Deployment is running
- [ ] Pods are healthy (not CrashLoopBackOff)
- [ ] Jobs can be created successfully
- [ ] Jobs execute commands correctly
- [ ] Jobs clean up after completion
- [ ] RBAC prevents cluster-wide access
- [ ] Resource limits are respected
- [ ] Helm chart installs successfully
- [ ] Helm upgrade works correctly
- [ ] Helm rollback works correctly

---

## Next Steps

After Phase 1 validation:

1. **Test in staging cluster** (cloud)
2. **Load testing** - Spawn multiple concurrent Jobs
3. **Monitor resource usage** - CPU, memory, storage
4. **Verify cost optimization** - Compare to E2B costs
5. **Document runbook** - Common issues and fixes

After Phase 2 completion:

1. **Deploy to production** via Helm
2. **Set up monitoring** (Prometheus, Grafana)
3. **Configure alerting** (failed Jobs, high resource usage)
4. **Implement scaling** (HPA based on load)
5. **Document Day 2 operations** - Upgrade, rollback procedures

---

## Support

**Issues? Check:**
- `.quint/k8s/README.md` - Detailed K8s architecture
- `k8s/README.md` - Troubleshooting guide
- DRR-2025-12-30-001 - Decision rationale

**Commands:**
```bash
# Check cluster status
kubectl cluster-info
kubectl get nodes

# Check resources
kubectl get all
kubectl describe pod <pod-name>

# Check logs
kubectl logs -l app=ci-fixer --tail=100 -f

# Port forward
kubectl port-forward deployment/ci-fixer-app 3000:3001
```

