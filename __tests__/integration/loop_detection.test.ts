
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analysisNode } from '../../agent/graph/nodes/analysis';
import { LoopDetector } from '../../services/LoopDetector';
import { GraphState, GraphContext } from '../../agent/graph/state';
import { defaultServices } from '../../services/container';
import * as LogAnalysisService from '../../services/analysis/LogAnalysisService';

// Mock dependencies
vi.mock('../../services/analysis/LogAnalysisService', async (importOriginal) => {
    const actual = await importOriginal<typeof LogAnalysisService>();
    return {
        ...actual,
        diagnoseError: vi.fn().mockResolvedValue({
            summary: "Mock Diagnosis",
            fixAction: "edit",
            reasoning: "Mock reasoning"
        }),
        generateRepoSummary: vi.fn().mockResolvedValue("Mock Repo Summary")
    };
});

vi.mock('../../services/github/GitHubService', () => ({
    getWorkflowLogs: vi.fn().mockResolvedValue({ logText: "Error: Syntax Error" })
}));

describe('Loop Detection Integration', () => {
    let mockState: GraphState;
    let mockContext: GraphContext;
    let loopDetector: LoopDetector;

    beforeEach(() => {
        loopDetector = new LoopDetector();
        
        mockState = {
            config: {} as any,
            group: { id: 1, mainRun: { head_sha: 'abc' } } as any,
            activeLog: "",
            currentNode: 'analysis',
            iteration: 0,
            maxIterations: 5,
            status: 'working',
            initialRepoContext: "",
            initialLogText: "",
            currentLogText: "Error: Syntax Error",
            files: {
                "src/app.ts": {
                    path: "src/app.ts",
                    modified: { content: "const x = 1;" },
                    original: { content: "const x = 1;" },
                    status: 'modified'
                } as any
            },
            fileReservations: [],
            history: [],
            feedback: [],
            complexityHistory: [],
            solvedNodes: []
        };

        mockContext = {
            services: {
                ...defaultServices,
                loopDetector: loopDetector
            },
            updateStateCallback: vi.fn(),
            logCallback: vi.fn()
        };

        vi.clearAllMocks();
    });

    it('should detect a loop and inject warning into diagnosis context', async () => {
        // First Iteration: Record state
        mockState.iteration = 0;
        await analysisNode(mockState, mockContext);

        // Second Iteration: Same state (simulating a loop)
        // We simulate that the previous verification failed and we are back at analysis
        // with the exact same files and error.
        mockState.iteration = 1;
        // files and currentLogText remain the same as defined in beforeEach

        await analysisNode(mockState, mockContext);

        // Check if diagnoseError was called with the warning
        const diagnoseMock = LogAnalysisService.diagnoseError as any;
        const calls = diagnoseMock.mock.calls;
        
        expect(calls.length).toBe(2);

        // First call should NOT have the warning
        const firstCallArg = calls[0][1]; // currentLogText is 2nd arg
        expect(firstCallArg).not.toContain("LOOP DETECTED");

        // Second call SHOULD have the warning
        const secondCallArg = calls[1][1];
        expect(secondCallArg).toContain("LOOP DETECTED");
        expect(secondCallArg).toContain("You MUST change your strategy");
        
        // Also check feedback was updated
        expect(mockState.feedback.some(f => f.includes("LOOP DETECTED"))).toBe(true);
    });

    it('should NOT detect loop if files change', async () => {
        // First Iteration
        mockState.iteration = 0;
        await analysisNode(mockState, mockContext);

        // Second Iteration: Files changed
        mockState.iteration = 1;
        mockState.files["src/app.ts"].modified.content = "const x = 2;"; // Changed content

        await analysisNode(mockState, mockContext);

        const diagnoseMock = LogAnalysisService.diagnoseError as any;
        const calls = diagnoseMock.mock.calls;
        
        const secondCallArg = calls[1][1];
        expect(secondCallArg).not.toContain("LOOP DETECTED");
    });
});
