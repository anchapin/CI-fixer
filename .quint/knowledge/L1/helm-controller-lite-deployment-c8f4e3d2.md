# Hypothesis: Helm-based Kubernetes Deployment with Controller-Lite Architecture

**ID:** `helm-controller-lite-deployment-c8f4e3d2`
**Layer:** L1 (Substantiated)
**Kind:** system
**Scope:** Global
**Status:** Verified
**Created:** 2025-12-30
**Verified:** 2025-12-30

---

## Problem Statement

CI-fixer needs a cloud-agnostic deployment strategy that:
- Works identically across local Minikube, AWS EKS, and GCP GKE
- Avoids configuration drift between environments (no duplicate YAML files)
- Provides Day 2 operations (upgrades, rollbacks, secrets management)
- Does not introduce unnecessary complexity (e.g., full Operator Framework)

---

## Proposed Solution

**Use Helm Charts for packaging** + **Controller-Lite pattern for runtime management**:

1. **Helm Chart**: Single template with environment-specific values files
2. **Controller-Lite**: Node.js app uses `@kubernetes/client-node` to spawn K8s Jobs directly
3. **No Operator Framework**: Logic stays in TypeScript, no Go/Ansible reconciliation needed
4. **No CRDs**: Manage standard K8s resources only (Jobs, Deployments, Services)

---

## Implementation Method

### Phase 1: Helm Chart Structure

Create `chart/` directory with standard Helm packaging:

```
chart/
├── Chart.yaml                 # Metadata (name: ci-fixer, version)
├── values.yaml                # Default config (Local Minikube)
├── values-prod.yaml           # Production config (Cloud K8s)
└── templates/
    ├── deployment.yaml        # Main app container
    ├── service.yaml           # Expose port 3000
    ├── rbac.yaml              # ServiceAccount + Role + RoleBinding
    ├── configmap.yaml         # Environment variables
    └── secret.yaml            # API keys (GitHub, OpenAI, DB)
```

**Key Helm Features**:
- `values.yaml`: Minikube defaults (no GPU, standard storage)
- `values-prod.yaml`: Production overrides (GPU enabled, fast storage classes)
- Template helpers: `{{ .Values.enableGPU }}`, `{{ .Values.storageClass }}`

### Phase 2: Controller-Lite Implementation

Continue using `@kubernetes/client-node` within the app (as planned in Phase 3 of kubernetes-native-sandbox-architecture):

```typescript
// No changes needed - app already manages K8s Jobs via TypeScript
import * as k8s from '@kubernetes/client-node';

export class KubernetesSandboxService {
  async spawnSandbox(sandboxId: string, command: string) {
    // Direct K8s API call - no Operator middleware
    await this.batchApi.createNamespacedJob(namespace, jobManifest);
  }
}
```

### Phase 3: RBAC Scoping

Grant minimal permissions via `rbac.yaml`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ci-fixer-job-manager
rules:
- apiGroups: ["batch"]
  resources: ["jobs", "jobs/status"]
  verbs: ["get", "list", "watch", "create", "delete"]
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
```

### Phase 4: Deployment Workflow

**Local Development**:
```bash
# Deploy to Minikube with default config
helm install ci-fixer ./chart
# or explicitly:
helm install ci-fixer ./chart -f values.yaml
```

**Production Deployment**:
```bash
# Deploy to cloud with production config
helm install ci-fixer ./chart -f values-prod.yaml
```

**Upgrades**:
```bash
helm upgrade ci-fixer ./chart -f values-prod.yaml --reuse-values
```

**Rollbacks**:
```bash
helm rollback ci-fixer 1  # Rollback to previous release
```

---

## Expected Outcomes

1. **Configuration Portability**: Single Helm chart deploys to any K8s cluster via values file toggle
2. **Runtime Flexibility**: App spawns K8s Jobs via TypeScript client (Controller-Lite), not external Operator
3. **Simplified Operations**: No CRDs to install, no reconciliation loops to debug
4. **Day 2 Readiness**: Upgrades/rollbacks via native Helm commands
5. **Cost Efficiency**: 90% of Operator power with 10% complexity overhead

---

## Success Metrics

- ✅ Deploy to fresh Minikube cluster with single command (`helm install`)
- ✅ Deploy to production (EKS/GKE) with single flag change (`-f values-prod.yaml`)
- ✅ RBAC correctly scoped (can create Jobs, cannot delete cluster resources)
- ✅ No Custom Resource Definitions (CRDs) installed in cluster
- ✅ Upgrade path documented (`helm upgrade ci-fixer ./chart`)
- ✅ Secrets managed via K8s Secrets (not in values files)

---

## Rationale

- **Source**: User proposal based on Kubernetes best practices
- **Anomaly**: Need cloud-agnostic deployment strategy for CI-fixer that works locally and in production without complexity overhead
- **Note**: User proposed Helm packaging with Controller-Lite approach (app-managed K8s Jobs) instead of full Operator Framework

---

## Explicit Decisions (Why NOT Operator Framework?)

| Decision | Reasoning |
|----------|-----------|
| **Helm: YES** | Solves configuration drift between environments |
| **Operator: NO** | Node.js app already has orchestration logic; rewriting in Go/Ansible adds complexity |
| **CRDs: NO** | `kubectl get agents` is nice-to-have but not necessary; standard Jobs are sufficient |
| **Controller-Lite** | Use `@kubernetes/client-node` directly; 90% power, 10% complexity |

---

## Logical Verification (L0 → L1)

### Type Check (C.3 Kind-CAL)
✅ **PASSED**: Hypothesis respects project types (system-level architecture). No type violations detected.

### Constraint Check
✅ **PASSED**:
- Helm chart structure follows standard conventions
- RBAC scoped to Job/Pod resources (no cluster-wide permissions)
- No violation of existing invariants
- Compatible with existing `@kubernetes/client-node@^1.4.0` dependency

### Logical Consistency Check
✅ **PASSED**:
- **Method → Outcome**: Single Helm chart with environment-specific values files logically achieves cloud-agnostic deployment
- **Completeness**: All necessary K8s resources included (Deployment, Service, RBAC, ConfigMap, Secret)
- **Dependency Sound**: Controller-Lite approach builds on existing K8s-native sandbox architecture (kubernetes-native-sandbox-architecture-2a332164)
- **Abstraction Valid**: Avoiding Operator Framework eliminates complexity while maintaining required functionality
- **Day 2 Operations**: Upgrades/rollbacks via native Helm commands are standard practices

### Verification Notes
- Helm is the industry standard for K8s package management (backed by CNCF)
- RBAC follows principle of least privilege (Jobs/Pods in specific namespace only)
- Values file pattern (values.yaml vs values-prod.yaml) prevents configuration drift
- Controller-Lite is consistent with existing TypeScript codebase (no Go/Ansible required)
- No CRDs means faster development iteration and lower cognitive load

---

## Verification Record

| Check | Status | Details |
|-------|--------|---------|
| Type Check | ✅ PASS | System-level hypothesis, compatible with project types |
| Constraint Check | ✅ PASS | No invariant violations; RBAC properly scoped |
| Logic Check | ✅ PASS | Method leads to expected outcomes; sound reasoning |
| **Overall Verdict** | **PASS** | **L0 → L1 PROMOTED** |

**Verified By**: FPF Phase 2 (Deduction)
**Verification Date**: 2025-12-30

---

## Next Steps

Proceed to `/q3-validate` to create implementation validation tests (Induction phase).

**Validation Checklist**:
1. Create Helm chart structure in `chart/` directory
2. Write Helm template files (deployment.yaml, service.yaml, rbac.yaml)
3. Create values.yaml and values-prod.yaml
4. Deploy to Minikube and verify `helm install` works
5. Deploy to test cluster and verify production config
6. Test upgrade/rollback scenarios
7. Verify RBAC permissions are correctly scoped

