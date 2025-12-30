# CI-Fixer Bounded Context

**Project:** CI-Fixer (recursive-devops-agent)
**Domain:** Autonomous CI/CD Failure Diagnosis and Repair
**Date:** 2025-12-30
**Last Commit:** 29f2bb9 - test(agent): improve test stability and coverage (2025-12-30)
**Recent Focus:** Multi-layer reliability enhancements with adaptive thresholds and recovery strategies

## Vocabulary

| Term | Definition |
|------|------------|
| **AgentRun** | A single execution session tracking the agent's attempt to fix a CI failure. Stored in SQLite with state, metrics, and cost tracking. |
| **ErrorFact** | An error instance extracted from CI logs with fingerprint, status (pending/resolved/failed), and metadata. |
| **FixPattern** | A successful fix template stored in the knowledge base for future retrieval. Includes error fingerprint, fix strategy, and success metrics. |
| **Graph Coordinator** | The orchestrator that manages specialized nodes (Analysis, Planning, Execution, Verification) in a graph-based architecture. |
| **Holon** | A unit of reasoning in the FPF framework, containing hypotheses, evidence, and decisions across layers L0-L3. |
| **Sandbox** | Execution environment isolation layer supporting E2B (cloud microVMs) or Docker (local containers). |
| **Service Container** | Dependency injection pattern in `/services/container.ts` that manages all business logic services. |
| **Trace** | OpenTelemetry execution trace for debugging and observability. |
| **TDD (Test-Driven Development)** | Red-Green-Refactor workflow: write failing tests first (Red), implement to pass (Green), then improve code (Refactor). |
| **Language Scoping** | Hybrid keyword/manifest detection that enforces strict boundaries between JS/TS, Python, and Go contexts to ensure relevant file/tool selection. |
| **Path Verification** | Automatic correction of hallucinated file paths to prevent directory traversal attacks. |
| **Dependency Solver** | Autonomous package manager integration that resolves and installs dependencies when reproduction fails due to missing packages. |
| **Reliability Layer** | Multi-phase protection system with adaptive thresholds, loop detection, and recovery strategies for preventing infinite loops. |
| **ReliabilityEvent** | Telemetry table tracking when reliability layers trigger, including context, outcome, and recovery success. |
| **ToolOrchestra** | Multi-objective optimization system tracking cost, latency, token usage, and quality metrics for tool invocations. |

## Invariants

### Architecture Invariants
- **Service Container Pattern**: All service dependencies MUST be injected through `/services/container.ts`. No direct imports of services in business logic.
- **Graph-Based Agent**: The agent MUST use the graph coordinator with specialized nodes. No monolithic agent implementations.
- **Pluggable Sandbox**: Execution strategy MUST be switchable between E2B and Docker via configuration. No hardcoded execution paths.
- **State Persistence**: All agent state MUST be persisted to SQLite via Prisma ORM. No in-memory-only state.

### Development Invariants
- **TDD Workflow**: All features MUST start with failing tests. Red-Green-Refactor cycle is MANDATORY.
- **Coverage Requirement**: Code coverage MUST be >85% lines and >80% branches/functions (enforced in vitest.config.ts).
- **Non-Interactive Commands**: Use `CI=true` environment variable for watch-mode tools (tests, linters) to ensure single execution in CI environments.
- **Conductor Workflow**: All work MUST be tracked in `conductor/tracks/*/plan.md`. Tasks marked `[~]` during work, `[x]` with commit SHA when complete.

### Quality Invariants
- **Type Safety**: All code MUST use TypeScript strict mode. No `any` types without explicit justification.
- **Error Handling**: All external API calls MUST have proper error handling with user-friendly messages.
- **Path Verification**: All file operations MUST validate paths to prevent directory traversal attacks.
- **Security**: API keys MUST be stored in environment variables only. No hardcoded secrets in source code.

### Testing Invariants
- **Unit Tests**: MUST run in <100ms each. Mock all external dependencies (LLM, filesystem, network).
- **Integration Tests**: MUST complete in <5s each. Test multi-component interactions with real database.
- **E2E Tests**: Use Playwright for full system testing. Must test critical user paths.

### LLM Invariants
- **Multi-Adapter**: The system MUST support both Google Gemini and Z.ai (GLM-4.7) via environment variable configuration.
- **Provider Selection**: `VITE_LLM_PROVIDER` environment variable determines the active LLM provider.
- **Cost Tracking**: All LLM calls MUST be tracked in `FixAttempt` table with token counts and cost metrics.

### Agent Workflow Invariants
- **Language Scoping**: The agent MUST detect project language and enforce boundaries in file discovery and tool selection.
- **Path Verification**: All file paths MUST be verified before execution to prevent hallucinated path errors.
- **Dependency Resolution**: When reproduction fails due to missing dependencies, the agent MUST attempt autonomous dependency resolution before requesting human intervention.
- **Graph Execution**: The agent coordinator MUST execute nodes in dependency order, enabling parallel execution when possible.

### Git Workflow Invariants
- **Conventional Commits**: All commits MUST follow `<type>(<scope>): <description>` format.
- **Git Notes**: Every completed task MUST have a git note attached with detailed summary.
- **Phase Checkpoints**: Each phase MUST end with a checkpoint commit and verification report.

## Domain Constraints

### Execution Environment
- **Node.js**: v18 or higher required
- **Database**: SQLite with Prisma ORM (PostgreSQL optional for production)
- **Sandbox Options**: E2B (cloud, requires API key) or Docker (local, requires Docker Desktop)

### Current Phase Context
- **Active Tracks**: Check `conductor/tracks/*/plan.md` for active development tracks
- **Recent Work**: Multi-layer reliability enhancements (Phases 2-4), adaptive thresholds, recovery strategies
- **Tech Stack**: React 19.2.1 + Vite (port 5173), Node.js/Express (port 3001), SQLite/Prisma, Vitest, Playwright
- **Test Coverage**: 85% lines, 80% branches enforced in vitest.config.ts
- **Current Session**: 2025-12-30 - Context initialization for reasoning session

### Security Constraints
- **Path Validation**: All user-provided paths MUST be validated against project root
- **Command Injection**: Shell commands MUST be sanitized/escaped before execution
- **Sandbox Isolation**: Code execution MUST occur in isolated environments (E2B/Docker)

## Integration Points

### External APIs
- **GitHub API**: Requires `GITHUB_TOKEN` for fetching logs and workflow status
- **E2B API**: Requires `E2B_API_KEY` for cloud sandbox execution
- **Tavily Search**: Requires `TAVILY_API_KEY` for web search functionality
- **LLM APIs**: Gemini or Z.ai keys required based on provider selection

### Internal Services
- **LogAnalysisService** (`/services/analysis/`): Parses logs, generates error fingerprints
- **FileDiscoveryService** (`/services/sandbox/`): File search and discovery in sandboxes with language scoping
- **PathVerificationService** (`/services/`): Validates and corrects hallucinated file paths
- **DependencySolverService** (`/services/`): Autonomous package manager integration for dependency resolution
- **Agent Tools** (`/services/sandbox/agent_tools.ts`): Tool execution interface for agents
- **Graph Coordinator** (`/agent/graph/coordinator.ts`): Orchestrates specialized nodes in DAG execution
- **Worker Loop** (`/agent/worker.ts`): Main execution loop that runs the graph-based agent
- **ReliabilityManager** (`/services/reliability/`): Manages adaptive thresholds, loop detection, and recovery strategies
