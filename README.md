<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# CI-Fixer: Recursive DevOps Agent

CI-Fixer is an intelligent agent designed to autonomously diagnose and fix GitHub Actions CI failures. It creates a local reproduction environment, analyzes logs, searches code, and verifies fixes before attempting to push them.

## 🏗️ Architecture

The application architecture has evolved to separate concerns for better stability and performance:

-   **Frontend (React/Vite)**: Provides the interactive chat interface, specialized diff views, terminal output, and real-time settings management.
-   **Backend (Node.js/Express)**: Manages the agent's lifecycle, state persistence (**SQLite/Prisma**), and orchestrates interactions with external tools.
-   **Execution Engine**: Pluggable sandbox environment supporting both Cloud (E2B) and Local (Docker) execution strategies.
-   **Agent Core**: Implements a **Graph-Based** architecture where a coordinator orchestrates specialized nodes (Analysis, Decomposition, Planning, Execution, Verification) to solve complex problems.
-   **Knowledge Base**: A self-learning memory system that fingerprints errors and retrieves successful fix patterns from historical data and runbooks to speed up resolution.
-   **Context Engine**: Uses AST-based dependency graph analysis to understand code relationships and intelligently isolate relevant files.

## 🚀 Getting Started

### Prerequisites

-   **Node.js**: v18 or higher
-   **Docker Desktop**: (Optional) Required if you plan to use the **Local Docker** execution strategy.

### Installation

```bash
npm install
npx prisma db push
```

### Configuration

1.  Copy `.env.example` to `.env.local`.
2.  Refer to [SETUP.md](./SETUP.md) for detailed configuration of LLM providers (Google Gemini vs Z.ai).
3.  Ensure you have a valid **GitHub Token** for accessing repositories.

### Running the App

Start both the backend server and frontend client concurrently:

```bash
npm run dev
```

-   **Frontend**: [http://localhost:5173](http://localhost:5173)
-   **Backend**: [http://localhost:3000](http://localhost:3000)

## 🐳 Execution Environments

You can configure the agent's environment strategy via the **Settings Modal** in the UI:

### 1. Cloud Sandbox (E2B) - Default
Uses [E2B.dev](https://e2b.dev)'s secure cloud microVMs.
-   **Pros**: Secure, isolated, no local resource usage.
-   **Requires**: `E2B_API_KEY`.

### 2. Local Docker Container (New!)
Runs the agent's reproduction steps in a container on your local machine.
-   **Pros**: Free, lower latency, full control over base images, works offline.
-   **Requires**: Docker Desktop running locally.
-   **Configuration**: Select **Execution Strategy: Local Docker Container** in Settings. You can specify a custom Docker image (default: `nikolaik/python-nodejs:python3.11-nodejs20-bullseye`).

## ⚡ Benchmarks & RL Gym

CI-Fixer now features a Reinforcement Learning (RL) ready environment and benchmark suite.
-   **Benchmark Suite**: Measure agent success rates against real repos.
-   **RL Gym**: Collect training data for "Agent Lightning" style optimization.

Full documentation: [BENCHMARKS.md](./BENCHMARKS.md)

## 🧪 Testing

The project includes a comprehensive test suite:

-   **All Tests**: `npm test`
-   **Unit Tests**: `npm run test:unit`
-   **Integration Tests**: `npm run test:integration`
-   **Coverage Report**: `npm run test:coverage`
-   **E2E Tests**: `npm run test:e2e` (Playwright)
