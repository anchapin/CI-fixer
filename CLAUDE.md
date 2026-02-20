# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CI-Fixer** (recursive-devops-agent) is an intelligent autonomous agent that diagnoses and fixes GitHub Actions CI failures. It uses a graph-based agent architecture with specialized nodes for analysis, planning, execution, and verification.

**Tech Stack:**
- Frontend: React 19.2.1 + Vite (port 5173)
- Backend: Node.js/Express (port 3001)
- Database: SQLite with Prisma ORM
- LLM: Google Gemini or Z.ai (GLM-4.7)
- Testing: Vitest (unit/integration), Playwright (e2e)
- Execution: E2B cloud microVMs or local Docker containers
- Deployment: Kubernetes-native architecture (see k8s/)

## Development Commands

```bash
# Setup
npm install
npx prisma db push  # Initialize SQLite database

# Development
npm run dev          # Start both frontend (5173) and backend (3001)

# Testing
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:coverage       # Coverage report (thresholds: 85% lines, 80% branches)
npm run test:e2e            # End-to-end tests (Playwright)
npm run test:ci             # Run coverage + e2e tests (CI pipeline)

# Run single test file
vitest run path/to/test.test.ts

# Build
npm run build              # Production build
npm run preview            # Preview production build

# Utilities
npm run benchmark          # Run agent benchmarks
npm run view-traces        # Debug trace visualization
npm run fix-tests          # Auto-fix test failures to ensure coverage
npm run check-reliability  # Verify test reliability
```

## Architecture

### Multi-Layer Design

1. **Frontend** (`/App.tsx`, `/components/`): Chat interface with TanStack AI streaming, diff views, settings management
2. **Backend** (`/server.ts`): Agent lifecycle, state persistence, HTTP/WebSocket API
3. **Agent Core** (`/agent/graph/`): Graph-based coordinator orchestrating specialized nodes:
   - **Analysis Node** (`agent/graph/nodes/analysis.ts`): Parses logs and identifies error patterns
   - **Decomposition Node** (`agent/graph/nodes/decomposition.ts`): Breaks down complex problems
   - **Planning Node** (`agent/graph/nodes/planning.ts`): Generates fix strategies
   - **Execution Node** (`agent/graph/nodes/execution.ts`): Applies fixes using tools
   - **Verification Node** (`agent/graph/nodes/verification.ts`): Validates solutions
4. **Services** (`/services/`): Business logic with dependency injection via `/services/container.ts`
5. **Knowledge Base**: Self-learning memory with error fingerprinting and fix pattern retrieval

### Key Architectural Patterns

- **Service Container Pattern**: Centralized dependency injection in `/services/container.ts`. When adding services:
  1. Create service in `/services/`
  2. Add initialization logic in `container.ts`
  3. Inject via constructor parameters for testability
  4. Mock services in tests using Vitest's `vi.mock()`

- **Graph-Based Execution**: DAG coordinator (`agent/graph/coordinator.ts`) orchestrates specialized nodes that can execute in parallel when dependencies allow. Each node has dependencies and produces outputs used by subsequent nodes.

- **Multi-Adapter LLM**: Supports Gemini and Z.ai via environment variables. Configuration centralized in `services/llm/`.

- **Pluggable Sandbox**: Switch between E2B (cloud) and Docker (local) execution adapters in `services/sandbox/`.

- **Language Scoping**: Hybrid keyword/manifest detection enforces strict boundaries between JS/TS, Python, and Go contexts via `services/analysis/`.

- **Path Verification**: Automatically corrects hallucinated file paths via `services/PathVerificationService.ts`. Prevents directory traversal attacks.

### Directory Structure

```
agent/                 # Agent core (graph coordinator, supervisor, worker)
├── graph/            # Graph-based coordinator and specialized nodes
│   └── nodes/        # Analysis, decomposition, planning, execution, verification
├── gym/              # RL gym environment for benchmarking
└── worker.ts         # Main worker loop executing the graph
components/           # React components (frontend)
conductor/            # Project management workflow
├── tracks/          # Active development tracks with plan.md
├── archive/         # Completed tracks
└── workflow.md      # Development workflow (TDD, phase checkpoints)
services/            # Business logic
├── analysis/       # Log parsing, error fingerprinting, language scoping
├── sandbox/        # E2B/Docker execution adapters
├── llm/           # LLM provider adapters
├── knowledge-base/ # Error pattern storage and retrieval
└── container.ts   # Dependency injection
__tests__/          # Test suite
├── unit/          # Fast isolated tests (<100ms)
├── integration/   # Multi-component tests (<5s)
├── e2e/          # Full system tests (Playwright)
├── mocks/        # Mock implementations
├── fixtures/     # Test data and helpers
└── helpers/      # Custom assertions and builders
k8s/               # Kubernetes deployment manifests
prisma/            # Database schema and migrations
benchmarks/        # Benchmark suite and cases
scripts/           # Utility scripts (benchmark runner, trace viewer, etc.)
```

## Configuration

### LLM Provider
**Z.ai (recommended for coding):**
```bash
VITE_LLM_PROVIDER=zai
GEMINI_API_KEY=your_z_ai_key  # Variable reused for simplicity
```
**Gemini (default):**
```bash
VITE_LLM_PROVIDER=gemini  # or leave undefined
GEMINI_API_KEY=your_google_key
```

### Required Environment Variables
- `GITHUB_TOKEN`: GitHub API access
- `GEMINI_API_KEY` or `API_KEY`: LLM provider
- `E2B_API_KEY`: E2B sandbox (cloud execution) - optional if using Docker
- `TAVILY_API_KEY`: Search functionality - optional

See `.env.example` for full template. Copy to `.env.local` and configure.

## Testing Requirements

**Coverage Thresholds** (enforced in vitest.config.ts):
- 85% lines
- 80% functions
- 80% branches
- 85% statements

**Test Duration Limits:**
- Unit tests: <100ms each
- Integration tests: <5s each
- E2E tests: No strict limit but should be reasonably fast

**TDD Workflow:**
1. Write failing tests first (Red phase)
2. Implement minimum code to pass (Green phase)
3. Refactor with test safety
4. Verify coverage >80%

**Non-Interactive Mode:**
Use `CI=true` for watch-mode tools to ensure single execution.

## Database Schema

Core models (Prisma/SQLite):
- `AgentRun`: Execution session tracking
- `ErrorFact`: Error instances with status
- `FileModification`: Changes during fixes
- `FixPattern`: Successful fix templates
- `FixAttempt`: Metrics and costs
- `RewardSignal`: RL training data
- `ReflectionEntry`: Learning system persistence

Run migrations: `npx prisma db push`

## Execution Strategies

Configurable via UI Settings:
1. **E2B Cloud**: Secure microVMs (requires `E2B_API_KEY`)
2. **Local Docker**: Free, offline, custom images (requires Docker Desktop)
3. **Simulation**: Dry run for planning
4. **GitHub Actions**: Direct CI verification

## Development Workflow

This project uses a **Conductor-managed** workflow with strict TDD. Work is tracked in `conductor/tracks/*/plan.md`.

**Task Lifecycle:**
1. Select task from `plan.md`
2. Mark in-progress: `[ ]` → `[~]`
3. Write failing tests (Red)
4. Implement to pass tests (Green)
5. Refactor (optional)
6. Verify coverage >80%
7. Commit: `feat(scope): description`
8. Attach git note with task summary: `git notes add -m "..." <commit-hash>`
9. Mark complete: `[~]` → `[x] <sha>` in plan.md
10. Commit plan update

**Phase Completion:**
- Run automated tests
- Propose manual verification plan
- Create checkpoint commit with verification report
- Attach report as git note

See `conductor/workflow.md` for full protocol.

## Benchmarks & RL Gym

The project includes infrastructure for benchmarking agent performance and collecting RL training data.

**Running Benchmarks:**
```bash
# Run default batch (first 20 cases)
npm run benchmark

# Run specific case
npx tsx scripts/run_benchmark.ts --case mock-failure-01

# Run via test suite
npx vitest run __tests__/benchmark.test.ts
```

**Public Datasets:**
- GitBug-Actions: Reproducible CI failures
- SWE-bench Lite: 300 real-world GitHub issues
- Use `scripts/populate_benchmarks.ts` to auto-fetch cases

**RL Gym:**
- Environment: `agent/gym/environment.ts`
- Recorder: `agent/gym/recorder.ts`
- Trajectories logged to: `logs/gym/traj_<id>_<timestamp>.json`

See `BENCHMARKS.md` for full documentation.

## Important Architectural Concepts

### Graph-Based Agent Execution
The coordinator (`agent/graph/coordinator.ts`) executes a Directed Acyclic Graph (DAG) of specialized nodes. Each node has dependencies and produces outputs used by subsequent nodes. This enables:
- Parallel execution of independent nodes
- Complex multi-step reasoning chains
- Transparent decision flow

### Service Injection Pattern
All services initialized through `services/container.ts`. Follow the four-step pattern described in Key Architectural Patterns above.

### Language Scoping System
The agent detects project language using hybrid keyword/manifest analysis (`services/analysis/`). This ensures:
- File discovery respects language boundaries
- Tool selection matches detected tech stack
- Context remains relevant to detected languages (JS/TS, Python, Go)

### File System Intelligence
- **Path Verification**: Automatically corrects hallucinated file paths
- **File Discovery**: Smart file location respecting `.gitignore`
- **Fallback Service**: Provides similar file suggestions when exact matches fail

### Kubernetes-Native Deployment
The project includes Kubernetes manifests for cloud deployment:
- `k8s/deployment.yaml`: Agent deployment
- `k8s/service.yaml`: Service exposure
- `k8s/configmap.yaml`: Configuration management
- `k8s/secrets.yaml`: Secret management

## Session Completion Protocol (bd workflow)

**CRITICAL**: Before ending a session, complete ALL steps:

1. **File issues** for remaining work (`bd create`)
2. **Run quality gates** (tests, linters, builds)
3. **Update issue status** (close completed work)
4. **PUSH TO REMOTE** (MANDATORY):
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up**: Clear stashes, prune remote branches
6. **Verify**: All changes committed AND pushed
7. **Hand off**: Provide context for next session

**Work is NOT complete until `git push` succeeds.**

## Security Considerations

- API keys stored in environment variables (`.env.local`)
- Path verification prevents directory traversal attacks
- Command validation on shell operations
- Sandbox isolation for code execution
- No hardcoded secrets in code

## Key Files to Reference

- `/server.ts`: Backend entry point
- `/App.tsx`: Frontend entry point
- `/services/container.ts`: Service initialization
- `/agent/graph/coordinator.ts`: Graph orchestration
- `/agent/worker.ts`: Main worker loop executing the graph
- `/types.ts`: TypeScript definitions
- `/conductor/workflow.md`: Development guidelines
- `/vitest.config.ts`: Test configuration and coverage thresholds
- `/prisma/schema.prisma`: Database schema

## Troubleshooting

**Tests failing with coverage errors:**
- Run `npm run fix-tests` to auto-fix test failures
- Check `vitest.config.ts` for excluded files
- Verify coverage thresholds in config

**Path hallucination issues:**
- Check `services/PathVerificationService.ts`
- Review absolute path conversion in `agent/worker.ts`
- Look at `services/FileDiscoveryService.ts`

**Sandbox connection problems:**
- Verify `E2B_API_KEY` for cloud execution
- Ensure Docker Desktop is running for local execution
- Check adapter selection in `services/sandbox/`

**Database issues:**
- Run `npx prisma db push` to sync schema
- Check `prisma/schema.prisma` for model definitions
- Use `debug-db.ts` for database inspection
