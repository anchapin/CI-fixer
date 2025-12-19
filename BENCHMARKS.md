# ⚡ Agent Lightning: Gym & Benchmarks

CI-Fixer now includes infrastructure to benchmark agent performance and record trajectories for Reinforcement Learning (RL), inspired by the **Agent Lightning** methodology.

## 🏋️ RL Gym Environment

We provide a custom Gym-like environment (`CIFixerEnv`) that standardizes the agent's interaction with the codebase. This allows:
1.  **Benchmarking**: Measuring success rates objectively.
2.  **Dataset Collection**: Recording agent actions, states, and rewards for offline training.
3.  **Future RL**: Training policy models to optimize agent decision-making using algorithms like PPO or GRPO.

### Key Components
-   **`agent/gym/environment.ts`**: The main class implementing `reset()` and `step()`.
-   **`agent/gym/recorder.ts`**: Handles logging of trajectories (Observation, Action, Reward tuples) to JSON files.

## 📊 Running Benchmarks

We have a dedicated benchmark suite to measure the agent's ability to fix CI failures.

### 1. Define Cases
Test cases are defined in `benchmarks/cases.json`.
```json
[
  {
    "id": "mock-failure-01",
    "repoUrl": "...",
    "expectedOutcome": "success"
  }
]
```

### 1a. Public Datasets
You can populate `cases.json` using the following public datasets:

1.  **[GitBug-Actions](https://github.com/gitbugactions/gitbugactions)**
    *   **Focus**: Reproducible CI failures and bug fixes using GitHub Actions.
    *   **Content**: A collection of repositories with broken CI states that can be reproduced locally.
    *   **Usage**: Clone the repositories, identify the failing commit, and add it to `cases.json`.

2.  **[SWE-bench Lite](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite)**
    *   **Focus**: Real-world GitHub issues (Python) where a PR fixed a bug including new tests.
    *   **Content**: 300 instances from popular repos (Django, scikit-learn, etc.).
    *   **Usage**: Use the `repo` and `base_commit` fields to define the "broken" state. Note that fixes usually involve code changes, not just CI config.

3.  **[GHALogs Analysis](https://zenodo.org/records/10259013)**
    *   **Focus**: Historical analysis of GitHub Actions workflows.
    *   **Usage**: Good for finding patterns of failure to create synthetic benchmarks.

### 1b. Automation Script
We include a helper script to automatically fetch and populate cases from SWE-bench Lite:

```bash
# Fetch the default 10 cases
npx tsx scripts/populate_benchmarks.ts

# Fetch a specific number of cases (max 300)
npx tsx scripts/populate_benchmarks.ts 50
```
This script fetches the latest test split from Hugging Face and appends new cases to `benchmarks/cases.json`. The SWE-bench Lite dataset contains 300 instances in total.

### 2. Run the Benchmark
Execute the runner script directly or via test suite:

**Direct Script:**
```bash
# Run default limited batch (first 20 cases)
npx tsx scripts/run_benchmark.ts

# Run with a custom limit
npx tsx scripts/run_benchmark.ts --limit 50

# Run a specific case ID (recommended for debugging)
npx tsx scripts/run_benchmark.ts --case mock-failure-01
```

**Via Test Suite:**
```bash
npx vitest run __tests__/benchmark.test.ts
```
*The test suite ensures the agent maintains a baseline success rate (e.g., >1%).*

## 💾 Data Collection

When running in the Gym environment, the agent automatically records its trajectory to:
`logs/gym/traj_<id>_<timestamp>.json`

These logs contain:
-   **Observations**: The `AgentState` before each action.
-   **Actions**: The command executed or file written.
-   **Rewards**: 
    -   `+10.0` for submitting a correct fix (verified).
    -   `-0.1` per step (efficiency).
    -   `-0.5` for failed commands.

This data is formatted for compliance with offline RL training pipelines.
