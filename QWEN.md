# CI-Fixer: Recursive DevOps Agent - Project Context

## Project Overview

CI-Fixer is an intelligent autonomous agent designed to diagnose and fix GitHub Actions CI failures. It implements a sophisticated multi-agent architecture with graph-based decision making, knowledge base learning, and multiple execution environments. The system creates local reproduction environments, analyzes logs, searches code, and verifies fixes before attempting to push them.

### Key Architecture Components

1. **Frontend (React/Vite)**: Interactive chat interface with specialized diff views, terminal output, and real-time settings management
2. **Backend (Node.js/Express)**: Manages agent lifecycle, state persistence (SQLite/Prisma), and orchestrates external tool interactions
3. **Execution Engine**: Pluggable sandbox supporting both Cloud (E2B) and Local (Docker) strategies
4. **Agent Core**: Graph-based architecture with specialized nodes (Analysis, Decomposition, Planning, Execution, Verification)
5. **Knowledge Base**: Self-learning memory system that fingerprints errors and retrieves successful fix patterns
6. **Context Engine**: AST-based dependency graph analysis for intelligent file isolation

### Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, TanStack AI
- **Backend**: Node.js, Express, TypeScript
- **Database**: SQLite with Prisma ORM
- **Sandbox Environments**: E2B Cloud MicroVMs, Local Docker
- **LLM Integration**: Google Gemini, Z.ai (GLM-4.7), with TanStack AI adapter
- **Testing**: Vitest, Playwright, custom benchmark suite
- **Telemetry**: OpenTelemetry with tracing capabilities

## Building and Running

### Prerequisites
- **Node.js**: v18 or higher
- **Docker Desktop**: Required if using Local Docker execution strategy

### Installation
```bash
npm install
npx prisma db push
```

### Configuration
1. Copy `.env.example` to `.env.local`
2. Configure LLM providers (Google Gemini or Z.ai) - see SETUP.md
3. Set valid GitHub Token for repository access

### Running the Application
Start both backend and frontend concurrently:
```bash
npm run dev
```
- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend**: [http://localhost:3000](http://localhost:3000)

### Available Scripts
- `npm run dev`: Start development servers (backend + frontend)
- `npm run server`: Start backend server only
- `npm run build`: Build the frontend application
- `npm run test`: Run all tests
- `npm run test:unit`: Run unit tests
- `npm run test:integration`: Run integration tests
- `npm run test:coverage`: Run tests with coverage report
- `npm run test:e2e`: Run Playwright end-to-end tests
- `npm run benchmark`: Run benchmark suite

## Development Conventions

### Code Structure
- `agent/`: Core agent logic with graph-based architecture
- `components/`: React UI components
- `services/`: Backend services (sandbox, metrics, knowledge base, etc.)
- `prisma/`: Database schema and migrations
- `__tests__/`: Test suites
- `sandbox.ts`: Sandbox environment implementations
- `types.ts`: Shared TypeScript interfaces and enums

### Agent Architecture
The agent follows a graph-based architecture with the following key phases:
- `UNDERSTAND`: Analyze error logs and repository context
- `PLAN`: Decompose problems and create execution plans
- `IMPLEMENT`: Apply fixes to codebase
- `VERIFY`: Test fixes in sandbox environment
- `SUCCESS/FAILURE`: Final states

### State Management
The application uses a sophisticated state management system with:
- `AgentState`: Tracks the current state of each agent run
- `GraphState`: Internal state for graph-based agent execution
- Prisma-based persistence for long-running operations
- Real-time UI updates via polling endpoints

### Testing Approach
- Unit tests for individual functions and components
- Integration tests for full-stack functionality
- End-to-end tests using Playwright
- Benchmark tests for performance measurement
- Simulation mode for testing without external dependencies

## Key Features

### Multi-Agent Pipeline
The system can deploy multiple autonomous agents concurrently to handle different CI failures simultaneously, with each agent operating independently while sharing knowledge through the central knowledge base.

### Execution Environments
- **Cloud Sandbox (E2B)**: Secure, isolated cloud microVMs (default)
- **Local Docker**: Containerized environment on the local machine

### Knowledge Base & Learning
- Error fingerprinting and pattern recognition
- Historical fix pattern storage and retrieval
- Reinforcement learning-ready architecture
- Metrics collection for continuous improvement

### Real-time Monitoring
- Live terminal output display
- Agent status tracking with phase indicators
- File change visualization with diff views
- Chat console integration for interactive debugging