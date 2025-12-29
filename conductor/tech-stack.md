# Technology Stack

## Core Technologies
- **Programming Languages:** TypeScript, Python, Go
- **Runtime Environments:** Node.js, Bun (for context-sensitive execution), Python 3.x, Go

## Frontend
- **Framework:** React
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Icons:** Lucide React

## Backend
- **Server Framework:** Express.js
- **Database:** SQLite
- **ORM:** Prisma

## Artificial Intelligence
- **LLM Provider:** Google Generative AI (@google/genai)
- **AI UI/UX:** TanStack AI
- **ML Pipeline:** TensorFlow or PyTorch (for model training), Scikit-learn (for metrics/evaluation)

## Testing & Quality Assurance
- **Unit & Integration Testing:** Vitest
- **Python Testing:** pytest, tox
- **JS/TS Testing:** Vitest, Jest, Mocha
- **End-to-End Testing:** Playwright
- **Fuzzy Search:** Fuse.js
- **Workflow Parsing:** js-yaml
- **Linting & Formatting:** ESLint, Prettier
- **Spell Checking:** CSpell (for generated patches)
- **Dockerfile Linting:** Hadolint

## Observability & Telemetry
- **Metrics & Tracing:** OpenTelemetry SDK

## Agent Services
- **Grounding & Verification:** `FileDiscoveryService`, `FileVerificationService`, `FileFallbackService`
- **Dependency Resolution:** `DependencySolverService`, `ProvisioningService`, `FixPatternService`
- **Diagnostic Engine:** `LoopDetector` (Hash-based), `ReproductionInferenceService`
- **Learning Infrastructure:** `LearningLoopService`, `LearningMetricService`, `RewardEngine`

## Execution Environment
- **Sandboxing:** E2B Code Interpreter, Docker (with persistent environment state)
