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
```

## Architecture

### Multi-Layer Design

1. **Frontend** (`/App.tsx`, `/components/`): Chat interface with TanStack AI streaming, diff views, settings management
2. **Backend** (`/server.ts`): Agent lifecycle, state persistence, HTTP/WebSocket API
3. **Agent Core** (`/agent/graph/`): Graph-based coordinator orchestrating specialized nodes:
   - Analysis Node: Parses logs and identifies error patterns
   - Planning Node: Generates fix strategies
   - Execution Node: Applies fixes using tools
   - Verification Node: Validates solutions
4. **Services** (`/services/`): Business logic with dependency injection via `/services/container.ts`
5. **Knowledge Base**: Self-learning memory with error fingerprinting and fix pattern retrieval

### Key Patterns

- **Service Container Pattern**: Centralized dependency injection in `/services/container.ts`
- **Multi-Adapter LLM**: Supports Gemini and Z.ai via environment variables
- **Pluggable Sandbox**: Switch between E2B (cloud) and Docker (local) execution
- **Graph-Based Execution**: DAG coordinator orchestrates specialized nodes that can execute in parallel when dependencies allow
- **Language Scoping**: Hybrid keyword/manifest detection enforces strict boundaries between JS/TS, Python, and Go contexts

## Directory Structure

```
agent/                 # Agent core (graph coordinator, supervisor, worker)
├── graph/            # Graph-based coordinator and specialized nodes
components/           # React components (frontend)
conductor/            # Project management workflow
├── tracks/          # Active development tracks with plan.md
├── archive/         # Completed tracks
└── workflow.md      # Development workflow (TDD, phase checkpoints)
services/            # Business logic
├── analysis/       # Log parsing, error fingerprinting
├── sandbox/        # E2B/Docker execution adapters
├── llm/           # LLM provider adapters
└── container.ts   # Dependency injection
__tests__/          # Test suite
├── unit/          # Fast isolated tests (<100ms)
├── integration/   # Multi-component tests (<5s)
└── e2e/          # Full system tests (Playwright)
prisma/            # Database schema and migrations
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
- `E2B_API_KEY`: E2B sandbox (cloud execution)
- `TAVILY_API_KEY`: Search functionality

See `.env.example` for full template.

## Development Workflow

This project uses a **Conductor-managed** workflow with strict TDD:

1. **Check `conductor/tracks/*/plan.md`** for current tasks
2. **Mark task in-progress** (`[ ]` → `[~]`)
3. **Write failing tests first** (Red-Green-Refactor)
4. **Implement to pass tests**
5. **Verify coverage >80%**
6. **Commit with conventional format** (`feat(scope): description`)
7. **Attach git note** with task summary
8. **Mark task complete** in plan.md (`[~]` → `[x]` with commit SHA)
9. **For phase completion**: Run automated tests, propose manual verification plan, create checkpoint commit

See `conductor/workflow.md` for full protocol.

## Testing Requirements

- **Unit tests**: <100ms each, >80% coverage
- **Integration tests**: <5s each
- **Coverage thresholds**: 85% lines, 80% functions/branches (enforced in vitest.config.ts)
- **TDD**: Write tests before implementation
- **Non-interactive**: Use `CI=true` for watch-mode tools

## Database Schema

Core models (Prisma/SQLite):
- `AgentRun`: Execution session tracking
- `ErrorFact`: Error instances with status
- `FileModification`: Changes during fixes
- `FixPattern`: Successful fix templates
- `FixAttempt`: Metrics and costs
- `RewardSignal`: RL training data

## Execution Strategies

Configurable via UI Settings:
1. **E2B Cloud**: Secure microVMs (requires `E2B_API_KEY`)
2. **Local Docker**: Free, offline, custom images (requires Docker Desktop)
3. **Simulation**: Dry run for planning
4. **GitHub Actions**: Direct CI verification

## Current Work

Check `conductor/tracks/*/plan.md` for active development tracks.
As of 2025-12-28, recent work includes dependency solver integration and agent workflow refinement.

## Key Files to Reference

- `/server.ts`: Backend entry point
- `/App.tsx`: Frontend entry point
- `/services/container.ts`: Service initialization
- `/agent/graph/coordinator.ts`: Graph orchestration
- `/agent/worker.ts`: Main worker loop executing the graph
- `/types.ts`: TypeScript definitions
- `conductor/workflow.md`: Development guidelines

## Important Architectural Concepts

### Graph-Based Agent Execution
The agent (`/agent/graph/coordinator.ts`) executes a Directed Acyclic Graph (DAG) of specialized nodes. Each node has dependencies and can produce outputs used by subsequent nodes. This enables:
- Parallel execution of independent nodes
- Complex multi-step reasoning chains
- Transparent decision flow

### Service Injection Pattern
All services are initialized through `/services/container.ts`. When adding new services:
1. Create the service in `/services/`
2. Add initialization logic in `container.ts`
3. Inject via constructor parameters for testability
4. Mock services in tests using Vitest's vi.mock()

### Language Scoping System
The agent detects project language using hybrid keyword/manifest analysis (`/services/analysis/`). This ensures:
- File discovery respects language boundaries
- Tool selection matches detected tech stack
- Context remains relevant to the detected languages (JS/TS, Python, Go)

### File System Intelligence
- **Path Verification**: Automatically corrects hallucinated file paths via `/services/PathVerificationService.ts`
- **File Discovery**: Smart file location respecting `.gitignore`
- **Fallback Service**: Provides similar file suggestions when exact matches fail

## Security Considerations

- API keys stored in environment variables (`.env.local`)
- Path verification prevents directory traversal attacks
- Command validation on shell operations
- Sandbox isolation for code execution
