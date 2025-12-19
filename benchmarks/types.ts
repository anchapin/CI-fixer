
export interface BenchmarkCase {
    id: string;
    description: string;
    repoUrl: string;
    commitSha: string | null;
    initialContext?: string;
    expectedOutcome: 'success' | 'failure'; // For now, we mostly want 'success' (the agent fixed it)
    timeoutSeconds: number;
    metadata?: any;
}

export interface BenchmarkResult {
    caseId: string;
    success: boolean;
    durationSeconds: number;
    stepsTaken: number;
    error?: string;
    model?: string;
}

export interface BenchmarkReport {
    timestamp: string;
    totalCases: number;
    successCount: number;
    failureCount: number;
    successRate: number; // 0.0 to 1.0
    results: BenchmarkResult[];
}
