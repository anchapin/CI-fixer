
export enum AgentPhase {
  IDLE = 'IDLE',
  INIT_REPO = 'INIT_REPO',
  UNDERSTAND = 'UNDERSTAND',
  REPRODUCE = 'REPRODUCE', // New Phase: Test-Driven Reproduction
  EXPLORE = 'EXPLORE', // New Phase: Active Shell Investigation
  PLAN = 'PLAN',
  PLAN_APPROVAL = 'PLAN_APPROVAL',
  ACQUIRE_LOCK = 'ACQUIRE_LOCK',
  TOOL_USE = 'TOOL_USE',
  IMPLEMENT = 'IMPLEMENT',
  VERIFY = 'VERIFY',
  RELEASE_LOCK = 'RELEASE_LOCK',
  CONSOLIDATE = 'CONSOLIDATE',
  TESTING = 'TESTING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
  ENVIRONMENT_SETUP = 'ENVIRONMENT_SETUP',
  PROVISIONING = 'PROVISIONING'
}

export enum ErrorCategory {
  DISK_SPACE = "disk_space",
  NETWORK = "network",
  AUTHENTICATION = "authentication",
  DEPENDENCY = "dependency",
  DEPENDENCY_CONFLICT = "dependency_conflict",
  SYNTAX = "syntax",
  RUNTIME = "runtime",
  BUILD = "build",
  TEST_FAILURE = "test_failure",
  TIMEOUT = "timeout",
  CONFIGURATION = "configuration",
  PATCH_PACKAGE_FAILURE = "patch_package_failure",
  MSW_ERROR = "msw_error",
  ENVIRONMENT_UNSTABLE = "environment_unstable",
  INFRASTRUCTURE = "infrastructure",
  UNKNOWN = "unknown"
}

export interface LogLine {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS' | 'TOOL' | 'VERBOSE';
  content: string;
  agentId?: string;
  agentName?: string;
  agentColor?: string;
}

export type CodeFile = {
  name: string;
  language: string;
  content: string;
  sha?: string;
}

export interface SimulationStep {
  phase: AgentPhase;
  message: string;
  delay: number;
  codeSnapshot?: CodeFile;
  logAppend?: LogLine;
  iteration?: number; // Added to simulate recursion steps
}

export interface WorkflowRun {
  id: number;
  name: string;
  path: string; // Relative path to .yml file (e.g. .github/workflows/test.yml)
  status: string;
  conclusion: string;
  head_sha: string;
  head_branch?: string; // Added for git operations
  html_url: string;
  reproductionCommand?: string;
}

export interface AppConfig {
  githubToken: string;
  repoUrl: string;
  prUrl?: string;
  selectedRuns?: WorkflowRun[];
  excludeWorkflowPatterns?: string[];

  // LLM Settings
  llmProvider?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  customApiKey?: string;
  llmTimeout?: number;

  // Search Settings
  searchProvider?: 'gemini_grounding' | 'tavily';
  tavilyApiKey?: string;

  // Execution Environments (Re-Architected)
  devEnv?: 'simulation' | 'e2b';           // For Agent Loop: Linting, Exploration
  checkEnv?: 'simulation' | 'github_actions' | 'e2b'; // For Test Phase: Final Verification

  e2bApiKey?: string;
  geminiApiKey?: string;
  sandboxTimeoutMinutes?: number; // Applies to GHA

  // Logging
  logLevel?: 'info' | 'debug' | 'verbose';

  // Execution Internal Logic
  executionBackend?: 'e2b' | 'docker_local';
  dockerImage?: string; // e.g., 'node:20-bullseye'
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export interface RunGroup {
  id: string;
  name: string;
  runIds: number[];
  mainRun: WorkflowRun;
}

export interface FileChange {
  path: string;
  original: CodeFile;
  modified: CodeFile;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  agentReasoning?: string;
}

export interface PlanTask {
  id: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  dependencies?: string[];
}

export interface AgentPlan {
  goal: string;
  tasks: PlanTask[];
  approved: boolean;
  judgeFeedback?: string;
  rejectionReason?: string;
  estimatedComplexity?: string;
}

// AoT Phase 2: DAG Decomposition
export interface ErrorNode {
  id: string;
  problem: string; // Concise problem description
  category: string; // Error category (DEPENDENCY, SYNTAX, etc.)
  affectedFiles: string[];
  dependencies: string[]; // IDs of prerequisite nodes
  complexity: number; // Estimated complexity
  priority: number; // Execution priority (1=highest)
}

export interface ErrorDAG {
  nodes: ErrorNode[];
  edges: Array<{ from: string; to: string }>; // Dependency edges
  rootProblem: string; // Original problem statement
}

export interface AgentState {
  groupId: string;
  name: string;
  phase: AgentPhase;
  iteration: number;
  status: 'idle' | 'working' | 'waiting' | 'success' | 'failed';
  currentNode?: string; // New: Current node in the execution graph
  message?: string;
  recommendation?: string;
  files: Record<string, FileChange>;
  currentPlan?: AgentPlan; // New: Store the active plan
  fileReservations?: string[]; // New: Files currently locked by this agent
  activeLog?: string; // New: The active log chunk being analyzed by this agent
  dbClient?: any; // Injectable database client for test isolation

  // ToolOrchestra Metrics
  totalCost?: number;
  totalLatency?: number;
  selectedTools?: string[];
  selectedModel?: string;
  rewardHistory?: number[];
  budgetRemaining?: number;
}

// Loop Detection Types

export type LoopStateHash = string;

export interface LoopStateSnapshot {
  iteration: number;
  filesChanged: string[]; // Paths of files changed in this iteration
  contentChecksum: string; // Hash of the content changes (or diffs)
  errorFingerprint: string; // Hash or signature of the error encountered
  timestamp: number;
}

export interface LoopDetectionResult {
  detected: boolean;
  message?: string;
  duplicateOfIteration?: number; // The iteration this loops back to
}

export interface ReproductionInferenceResult {
  command: string;
  confidence: number; // 0-1
  strategy: 'workflow' | 'signature' | 'build_tool' | 'agent_retry' | 'safe_scan';
  reasoning: string;
}

export interface GenerateContentResult {
  text: string;
  toolCalls?: any[];
  metrics?: {
    tokensInput: number;
    tokensOutput: number;
    cost: number;
    latency: number;
    model: string;
  };
}
