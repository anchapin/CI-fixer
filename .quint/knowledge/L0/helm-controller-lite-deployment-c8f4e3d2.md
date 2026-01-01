# Hypothesis: Helm-based Kubernetes Deployment with Controller-Lite Architecture

**ID:** `helm-controller-lite-deployment-c8f4e3d2`
**Layer:** L0 (Abduction/User Injection)
**Kind:** system
**Scope:** Global
**Status:** Proposed
**Created:** 2025-12-30

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

## Next Steps

Run `/q2-verify` to begin logical verification of this hypothesis (Deduction phase).

**Verification Checklist**:
1. Does Helm chart structure match Helm best practices?
2. Is RBAC correctly scoped for Job management?
3. Are values files properly separated (local vs production)?
4. Is Controller-Lite pattern sufficient for CI-fixer's needs?
5. Can upgrades/rollbacks be performed safely?

