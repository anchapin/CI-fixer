# Design Rationale Record

**ID:** `DRR-2025-12-30-001`
**Title:** Implement Kubernetes-Native Sandbox Architecture with Helm Deployment
**Date:** 2025-12-30
**Status:** ✅ APPROVED
**Decision Maker:** User (via Transformer Mandate)

---

## Context

CI-fixer needs a cloud-agnostic deployment strategy that:
- Works identically across local Minikube, AWS EKS, and GCP GKE
- Avoids configuration drift between environments
- Provides Day 2 operations (upgrades, rollbacks, secrets management)
- Does not introduce unnecessary complexity (e.g., full Operator Framework)
- Enables scalable sandbox execution for CI fix analysis

Current limitations:
- Local Docker socket mounting lacks multi-tenancy
- External SaaS providers (E2B) have per-execution costs
- Limited control over resource allocation and scheduling
- Data privacy concerns when execution leaves cluster

---

## Decision

**We decided to implement BOTH Kubernetes-Native Sandbox Architecture and Helm-based Kubernetes Deployment** in sequence:

1. **Phase 1:** Kubernetes-Native Sandbox Architecture (R_eff=0.85)
2. **Phase 2:** Helm-based Kubernetes Deployment (R_eff=0.80)

**Implementation Order:** K8s-native architecture first (foundation), then Helm packaging layer.

---

## Rationale

### Why Both?

**1. Dependency Soundness:**
- Helm deployment **depends on** K8s-native architecture
- Helm chart wraps existing K8s manifests (Deployment, RBAC, Service)
- Implementing K8s-native first validates the foundational architecture
- Helm then provides cloud-agnostic packaging on top of validated foundation

**2. Risk Mitigation:**
- K8s-native: LOW risk (R_eff=0.85, implementation complete)
- Helm: MEDIUM risk (R_eff=0.80, implementation not started)
- Validating K8s-native in cluster before Helm creation reduces dependency risk
- If K8s-native fails, Helm work is avoided (fail-fast approach)

**3. Value Proposition:**
- **K8s-Native:** Enables cluster-native sandbox execution with resource control
- **Helm:** Provides Day 2 operations (upgrades, rollbacks, multi-cloud deployment)
- Combined: Production-ready, cloud-agnostic CI fix platform

### Why K8s-Native First?

**Evidence Strength:**
- Highest R_eff (0.85) of all options
- Internal test validation (23/25 components, 92%)
- Implementation artifacts verified to exist
- No dependency risk (foundational hypothesis)

**Implementation Readiness:**
- ✅ Multi-stage Dockerfile created
- ✅ docker-compose.yml with health checks
- ✅ KubernetesSandbox class implemented
- ✅ K8s RBAC manifests created
- ✅ K8s Deployment manifest created

**Next Steps:**
- Deploy to Minikube for validation
- Test Job spawning lifecycle
- Validate RBAC permissions
- Confirm resource isolation

### Why Helm Second?

**Dependency Validation:**
- Builds on validated K8s-native architecture (R_eff=0.85)
- Wraps existing K8s manifests in Helm templates
- Straightforward implementation (low technical risk)

**Operational Value:**
- Cloud-agnostic deployment (single chart, multiple environments)
- Day 2 operations (upgrade, rollback, secrets management)
- Industry-standard packaging (CNCF best practices)
- Environment configuration (values.yaml vs values-prod.yaml)

**Controller-Lite Decision:**
- Avoided Operator Framework complexity
- Direct K8s API calls from TypeScript
- 90% of Operator power with 10% complexity
- Industry consensus: appropriate for simple Job spawning

---

## Consequences

### Positive Outcomes

**1. Architecture Benefits:**
- Resource control via K8s scheduler
- Self-healing via Job restart policies
- Scalability across cluster nodes
- Cost optimization (no external SaaS fees)
- Privacy (execution stays in-cluster)

**2. Operational Benefits:**
- Single command deployment to any cluster
- Environment-specific configuration via values files
- Standardized upgrade/rollback workflows
- Cloud-agnostic (works on Minikube, EKS, GKE)

**3. Development Benefits:**
- Local development via Docker Compose
- Production parity via K8s manifests
- Type-safe TypeScript implementation
- No Go/Ansible required (Controller-Lite)

### Trade-offs and Costs

**1. Implementation Effort:**
- K8s-native: Mostly complete, needs cluster testing
- Helm: Requires chart creation (~1-2 days work)
- **Total Effort:** LOW-MEDIUM

**2. Operational Complexity:**
- Requires Kubernetes cluster (local or cloud)
- RBAC management needed
- Helm chart maintenance
- **Mitigation:** All are standard K8s practices

**3. Dependency Risk:**
- Helm depends on K8s-native (cascading failure risk)
- Probability: LOW (K8s-native has R_eff=0.85)
- Impact: HIGH (Helm wraps K8s manifests)
- **Overall Risk:** MEDIUM (acceptable)

### Not Chosen

**Rejected Alternatives:**
- ❌ **Operator Framework:** Overkill for simple Job spawning
- ❌ **E2B-only:** Continued external costs, privacy concerns
- ❌ **Docker-only:** Lacks multi-tenancy and cloud portability
- ❌ **Manual YAML management:** Configuration drift, no Day 2 operations

---

## Implementation Plan

### Phase 1: Kubernetes-Native Validation

**Timeline:** Immediate (Week 1)

**Tasks:**
1. Deploy to Minikube (`kubectl apply -f k8s/rbac/k8s.yaml`)
2. Test CI-fixer app in cluster
3. Validate Job spawning via KubernetesSandbox class
4. Confirm Job cleanup (`ttlSecondsAfterFinished: 300`)
5. Verify RBAC permissions (least privilege)
6. Test resource limits (CPU, memory)
7. Document any issues and fixes

**Success Criteria:**
- ✅ Jobs spawn successfully
- ✅ Commands execute in pods
- ✅ Jobs clean up after completion
- ✅ RBAC permissions work correctly
- ✅ No cluster-wide access

### Phase 2: Helm Chart Creation

**Timeline:** After Phase 1 validation (Week 2)

**Tasks:**
1. Create `chart/` directory structure
2. Write `Chart.yaml` (metadata, version)
3. Write `templates/deployment.yaml` (wrap existing deployment)
4. Write `templates/service.yaml` (wrap existing service)
5. Write `templates/rbac.yaml` (wrap existing RBAC)
6. Write `templates/configmap.yaml` (environment variables)
7. Write `templates/secret.yaml` (API keys - use external secret mgmt)
8. Write `values.yaml` (Minikube defaults)
9. Write `values-prod.yaml` (production overrides)
10. Test deploy to Minikube (`helm install ci-fixer ./chart`)
11. Test deploy to cloud cluster (`helm install -f values-prod.yaml`)
12. Validate upgrade (`helm upgrade`)
13. Validate rollback (`helm rollback`)

**Success Criteria:**
- ✅ Chart installs successfully on Minikube
- ✅ Chart installs successfully on cloud cluster
- ✅ Values file overrides work correctly
- ✅ Upgrade preserves configuration
- ✅ Rollback restores previous version

---

## Validity Period

**Decision Valid Until:** 2026-06-30 (6 months)

**Revisit If:**
- K8s-native validation fails in cluster testing
- Helm chart encounters blocking issues
- Kubernetes deprecates Job API or RBAC patterns used
- Business requirements change (e.g., need for Operator features)
- Cost/benefit analysis changes (e.g., free E2B tier available)

**Review Triggers:**
- Phase 1 validation failures
- Production deployment issues
- Security vulnerabilities detected
- New Kubernetes features available

---

## Related Artifacts

**Hypotheses Selected:**
- `kubernetes-native-sandbox-architecture-2a332164` (L2, R_eff=0.85)
- `helm-controller-lite-deployment-c8f4e3d2` (L2, R_eff=0.80)

**Evidence:**
- `.quint/audits/calculate-r-kubernetes-native.md`
- `.quint/audits/calculate-r-helm-deployment.md`
- `.quint/audits/audit-tree-kubernetes-native.md`
- `.quint/audits/audit-tree-helm-deployment.md`

**Validation Results:**
- `.quint/validation-summary-phase3-induction.md`
- `.quint/audit-summary-phase4.md`

---

## Approval

**Decision:** ✅ **APPROVED**

**Approved By:** User (via Transformer Mandate)
**Date:** 2025-12-30
**Confidence:** HIGH (R_eff ≥ 0.80 for both hypotheses)

**Next Phase:** Implementation
**Immediate Action:** Deploy K8s-native architecture to Minikube for validation

---

## Signature

**Generated by:** Claude (FPF Phase 5: Decider)
**Method:** E.9 Design Rationale Record (DRR)
**Compliance:** RFC 2119, Transformer Mandate

**Relations Created:**
- DRR-2025-12-30-001 --selects--> kubernetes-native-sandbox-architecture-2a332164
- DRR-2025-12-30-001 --selects--> helm-controller-lite-deployment-c8f4e3d2

**No hypotheses rejected** (both approved for implementation).

