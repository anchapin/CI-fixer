
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
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS'
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
}

export interface AppConfig {
  githubToken: string;
  repoUrl: string;
  prUrl?: string;
  selectedRuns: WorkflowRun[];
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
  devEnv: 'simulation' | 'e2b';           // For Agent Loop: Linting, Exploration
  checkEnv: 'simulation' | 'github_actions' | 'e2b'; // For Test Phase: Final Verification

  e2bApiKey?: string;
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
  status: 'modified' | 'added' | 'deleted';
  agentReasoning?: string;
}

export interface PlanTask {
  id: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export interface AgentPlan {
  goal: string;
  tasks: PlanTask[];
  approved: boolean;
  judgeFeedback?: string;
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
