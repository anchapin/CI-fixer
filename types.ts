
export enum AgentPhase {
  IDLE = 'IDLE',
  INIT_REPO = 'INIT_REPO',
  UNDERSTAND = 'UNDERSTAND',
  PLAN = 'PLAN',
  PLAN_APPROVAL = 'PLAN_APPROVAL', // New Phase: Judge reviewing plan
  ACQUIRE_LOCK = 'ACQUIRE_LOCK', // New Phase: File Reservation
  TOOL_USE = 'TOOL_USE', 
  IMPLEMENT = 'IMPLEMENT',
  VERIFY = 'VERIFY',
  RELEASE_LOCK = 'RELEASE_LOCK', // New Phase: Releasing Reservation
  CONSOLIDATE = 'CONSOLIDATE', 
  TESTING = 'TESTING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS'
}

export interface LogLine {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS' | 'TOOL';
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
}

export interface WorkflowRun {
  id: number;
  name: string;
  path: string; // Relative path to .yml file (e.g. .github/workflows/test.yml)
  status: string;
  conclusion: string;
  head_sha: string;
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

  // Search Settings
  searchProvider?: 'gemini_grounding' | 'tavily';
  tavilyApiKey?: string;

  // Sandbox / Verification Settings
  sandboxMode?: 'simulation' | 'github_actions';
  sandboxTimeoutMinutes?: number;

  // Logging
  logLevel?: 'info' | 'debug' | 'verbose';
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
}
