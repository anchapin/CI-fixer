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
-   **Language Scoping**: Implements strict language boundaries (JS/TS, Python, Go) using hybrid keyword/manifest detection to ensure the agent prioritizes relevant files and tools for the detected technology stack.
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

-   **Frontend**: [http://localhost:3000](http://localhost:3000)
-   **Backend**: [http://localhost:3001](http://localhost:3001)

> **Note**: If port 3000 is in use, Vite will automatically try the next available port (e.g., 3001, 3002).

## 💻 CLI Usage (New!)

CI-Fixer now includes a **command-line interface** for fixing CI failures without the web UI. This is the recommended way to use CI-Fixer in CI/CD pipelines or for automation.

### Quick Start

```bash
# Install and build
npm install

# Run from CLI (recommended)
npm run fix -- --repo=facebook/react --run-ids=123,456,789

# Or use directly after npm link
npx ci-fixer fix --repo=owner/repo --run-ids=123
```

### Configuration File

Create a `.ci-fixer.yaml` file for persistent configuration:

```bash
npm run cli config init
```

Example configuration:

```yaml
github:
  token: ${GITHUB_TOKEN}

repo:
  url: owner/repo

llm:
  provider: google
  model: gemini-2.5-flash-preview-04-17

api_keys:
  gemini: ${GEMINI_API_KEY}
  tavily: ${TAVILY_API_KEY}
  e2b: ${E2B_API_KEY}

execution:
  backend: e2b
  dev_env: e2b
  check_env: github_actions
  sandbox_timeout: 30

logging:
  level: info
  format: pretty
```

### CLI Commands

#### `ci-fixer fix` - Fix CI failures

```bash
# Basic usage (reads from .ci-fixer.yaml)
ci-fixer fix

# Override config with CLI flags
ci-fixer fix --repo=facebook/react --run-ids=123,456,789

# With specific LLM and backend
ci-fixer fix --repo=owner/repo --llm=zai --backend=docker_local

# Dry run (validate without running)
ci-fixer fix --repo=owner/repo --dry-run

# JSON output for CI/CD
ci-fixer fix --repo=owner/repo --format=json | jq .

# Verbose logging
ci-fixer fix --repo=owner/repo --log-level=debug
```

**Options:**
- `--repo <owner/repo>` - Repository URL
- `--run-ids <ids>` - Comma-separated workflow run IDs
- `--pr <number>` - Pull request number
- `--exclude <patterns>` - Workflow patterns to exclude
- `--config <path>` - Path to config file (default: `.ci-fixer.yaml`)
- `--llm <provider>` - LLM provider (google, zai, openai)
- `--model <name>` - LLM model name
- `--backend <backend>` - Execution backend (e2b, docker_local, kubernetes)
- `--log-level <level>` - Log level (debug, info, warn, error)
- `--format <format>` - Output format (pretty, json, plain)
- `--dry-run` - Validate inputs without running agent

#### `ci-fixer ui` - Launch web interface

```bash
# Launch both frontend and backend
ci-fixer ui

# Launch on custom port
ci-fixer ui --port=8080

# Backend only
ci-fixer ui --backend-only
```

#### `ci-fixer config` - Manage configuration

```bash
# Create config file
ci-fixer config init

# Validate config
ci-fixer config validate

# Force overwrite existing config
ci-fixer config init --force
```

### Environment Variables

Required environment variables:

```bash
# GitHub authentication
export GITHUB_TOKEN=ghp_xxx

# LLM API keys (choose one)
export GEMINI_API_KEY=xxx  # For Google Gemini
export OPENAI_API_KEY=xxx  # For OpenAI

# Optional: Search and sandbox
export TAVILY_API_KEY=xxx
export E2B_API_KEY=xxx
```

### CLI Examples

**Fix a specific PR:**
```bash
ci-fixer fix --repo=facebook/react --pr=12345
```

**Fix with local Docker:**
```bash
ci-fixer fix --repo=owner/repo --backend=docker_local
```

**Fix with custom model:**
```bash
ci-fixer fix --repo=owner/repo --llm=zai --model=glm-4-plus
```

**Integration with CI/CD:**
```yaml
# .github/workflows/ci-fixer.yml
- name: Run CI-Fixer
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  run: |
    npx ci-fixer fix --repo=${{ github.repository }} --format=json
```

### CLI vs Web UI

| Feature | CLI | Web UI |
|---------|-----|--------|
| **Use case** | Automation, CI/CD, scripting | Interactive development, debugging |
| **Configuration** | YAML file + CLI flags | Settings modal |
| **Output** | Terminal, JSON | Visual dashboard, diff views |
| **Startup** | Instant | Requires browser |
| **Best for** | Production fixes, batch processing | Exploration, learning, monitoring |

**Tip:** Use the CLI for production workflows and the web UI for development/debugging.

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
