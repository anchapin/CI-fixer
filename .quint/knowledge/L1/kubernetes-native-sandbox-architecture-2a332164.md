# Hypothesis: Kubernetes-Native Sandbox Architecture

**ID:** `kubernetes-native-sandbox-architecture-2a332164`
**Layer:** L1 (Substantiated - Deduction Verified)
**Kind:** system
**Scope:** Global
**Status:** Verified - Ready for Validation
**Created:** 2025-12-30
**Verified:** 2025-12-30

---

## Problem Statement

Current sandbox execution relies on local Docker socket mounting or external SaaS providers (E2B), creating limitations in:

- **Control**: Limited ability to manage resource allocation, scheduling, and lifecycle
- **Privacy**: Data must leave the cluster for external SaaS execution
- **Cost**: External providers have per-execution costs; local Docker lacks multi-tenancy

---

## Proposed Solution

Transition CI-Fixer to a Kubernetes-native architecture where:

1. **Local Development**: Use Docker Compose with App + Database as sibling containers
2. **Production**: App acts as a Controller that spawns Kubernetes Jobs for sandbox execution

---

## Implementation Method

### Phase 1: Containerize Application

Create multi-stage `Dockerfile` for production builds:

```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy config files first to leverage caching
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev deps for building)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and build the TypeScript app
RUN npx prisma generate
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Expose the API port
EXPOSE 3000

# Start the server
CMD ["node", "dist/server.js"]
```

### Phase 2: Docker Compose Orchestration

Create `docker-compose.yml` with:

- Postgres service with health checks
- App service with dependency management
- Shared network for service communication
- Optional Docker socket mount for local sibling spawning

```yaml
version: '3.8'

services:
  # 1. The Database Service
  db:
    image: postgres:15-alpine
    container_name: cifixer-db
    restart: always
    environment:
      POSTGRES_USER: ${DB_USER:-cifixer}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-password}
      POSTGRES_DB: ${DB_NAME:-cifixer_db}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cifixer -d cifixer_db"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  # 2. The Main Application
  app:
    build: .
    container_name: cifixer-app
    restart: on-failure
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://${DB_USER:-cifixer}:${DB_PASSWORD:-password}@db:5432/${DB_NAME:-cifixer_db}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DOCKER_HOST=unix:///var/run/docker.sock
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - app-network

volumes:
  postgres_data:

networks:
  app-network:
```

### Phase 3: Kubernetes Controller Logic

Implement `KubernetesSandboxService` using `@kubernetes/client-node`:

```typescript
import * as k8s from '@kubernetes/client-node';

export class KubernetesSandboxService {
  private batchApi: k8s.BatchV1Api;
  private namespace = 'default';

  constructor() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.batchApi = kc.makeApiClient(k8s.BatchV1Api);
  }

  async spawnSandbox(sandboxId: string, command: string) {
    const jobName = `sandbox-${sandboxId}`;

    const jobManifest: k8s.V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: jobName,
        namespace: this.namespace,
        labels: {
          app: 'ci-fixer-sandbox',
          sandboxId: sandboxId
        }
      },
      spec: {
        ttlSecondsAfterFinished: 60,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'sandbox-runner',
                image: 'your-registry/sandbox-image:latest',
                command: ['/bin/sh', '-c', command],
                resources: {
                  requests: { cpu: '500m', memory: '512Mi' },
                  limits: { cpu: '1000m', memory: '1Gi' }
                }
              }
            ]
          }
        }
      }
    };

    await this.batchApi.createNamespacedJob(this.namespace, jobManifest);
    return { status: 'spawned', jobName };
  }
}
```

### Phase 4: Kubernetes Deployment Artifacts

- Deployment manifest for CI-Fixer app
- Service for API exposure
- RBAC (ServiceAccount, Role, RoleBinding) for Job/Pod permissions
- ConfigMap for environment-specific configuration

---

## Expected Outcomes

1. **Resource Control**: Kubernetes scheduler manages pod placement and resource allocation
2. **Self-Healing**: Failed Jobs auto-restart based on retry policies
3. **Scalability**: Multiple sandboxes run concurrently across cluster nodes
4. **Cost Optimization**: No external SaaS fees; use existing cluster capacity
5. **Privacy**: All execution stays within cluster boundaries
6. **Observability**: Native integration with cluster monitoring (Prometheus, logs)

---

## Rationale

- **Source**: User proposal based on DevOps best practices
- **Anomaly**: Current Docker/E2B approach has limitations in control, privacy, and cost
- **Note**: Architectural transition to Kubernetes-native execution model

---

---

## Verification Summary (Deduction Phase)

**Verification ID:** `verify-kubernetes-native-sandbox-architecture-2a332164-fd74821b`
**Date:** 2025-12-30
**Verifier:** q2-verify (Deductor)
**Result:** ✅ PASS (Promoted to L1)

### Checks Performed

1. **Type Check (C.3 Kind-CAL):** ✅ PASSED
   - KubernetesSandboxService interface compatible with existing SandboxEnvironment abstraction
   - Adapter pattern allows pluggable K8s implementation alongside E2B/Docker
   - @kubernetes/client-node provides TypeScript types for V1Job, BatchV1Api

2. **Constraint Check:** ✅ PASSED
   - Global scope appropriate for architectural transition
   - Services sandbox layer is within project's bounded context
   - Additive changes via new adapter pattern (no breaking changes)
   - Backward compatible with existing E2B/Docker adapters

3. **Logical Consistency:** ✅ PASSED
   - Multi-phase implementation follows logical dependency chain
   - Containerization (Phase 1) prerequisite for both local and production
   - Docker Compose (Phase 2) enables local development without cloud dependencies
   - K8s Controller (Phase 3) replaces E2B with cluster-native Job spawning
   - Deployment artifacts (Phase 4) required for production and RBAC

4. **Implementation Feasibility:** ✅ PASSED
   - @kubernetes/client-node provides BatchV1Api for Job management
   - Multi-stage Dockerfiles are standard practice for Node.js
   - Health checks and dependency management well-supported in Docker Compose
   - RBAC patterns for Job/Pod creation are documented
   - ttlSecondsAfterFinished natively supported in Job specs

5. **Architecture Compatibility:** ✅ PASSED
   - Fits existing service container (services/container.ts) pattern
   - Follows established adapter pattern for sandbox services
   - Constructor-based dependency injection compatible
   - K8s client can be mocked for unit testing
   - Configuration-based adapter selection already exists

### Recommendations for Implementation

- Implement Phase 1 (Dockerfile) first to establish containerization baseline
- KubernetesSandboxService should implement same interface as DockerSandboxService for consistency
- RBAC manifests should include least-privilege permissions (create/get/delete Jobs only)
- Add sandbox image build pipeline to Phase 4 for automated deployment
- Add health check endpoint to KubernetesSandboxService for readiness probes

---

## Next Steps

Run `/q3-validate` to begin empirical validation (Induction phase) of this substantiated hypothesis.
