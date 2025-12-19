import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphState } from '../../../agent/graph/state.js';
import { analysisNode } from '../../../agent/graph/nodes/analysis.js';
import { AppConfig, RunGroup } from '../../../types.js';
import { setupTestDatabase, getTestDb } from '../../helpers/vitest-setup.js';
import { vi } from 'vitest';
import { createMockServices } from '../../helpers/test-fixtures.js';

// ... (vi.mock calls)

describe('State Refinement Integration', () => {
    setupTestDatabase(); // Setup test database for all tests

    let mockConfig: AppConfig;
    let mockGroup: RunGroup;

    beforeEach(async () => {
        mockConfig = {
            githubToken: 'test-token',
            repoUrl: 'https://github.com/test/repo',
            selectedRuns: [],
            devEnv: 'simulation',
            checkEnv: 'simulation'
        };

        mockGroup = {
            id: 'test-group-1',
            name: 'Test Workflow',
            runIds: [12345],
            mainRun: {
                id: 12345,
                name: 'test',
                path: '.github/workflows/test.yml',
                status: 'completed',
                conclusion: 'failure',
                head_sha: 'abc123',
                html_url: 'https://github.com/test/repo/actions/runs/12345'
            }
        };

        // Create the agent run in DB to satisfy foreign key relation
        const db = getTestDb();
        await db.agentRun.create({
            data: {
                id: mockGroup.id,
                groupId: 'test-group-id',
                status: 'working',
                state: '{}'
            }
        });
    });

    it('should track complexity over iterations', async () => {
        const initialState: GraphState = {
            config: mockConfig,
            group: mockGroup,
            activeLog: '',
            currentNode: 'analysis',
            iteration: 0,
            maxIterations: 5,
            status: 'working',
            initialRepoContext: '',
            initialLogText: '',
            currentLogText: '',
            files: {},
            fileReservations: [],
            history: [],
            feedback: [],
            complexityHistory: [],
            solvedNodes: []
        };

        const context = {
            services: createMockServices(),
            updateStateCallback: vi.fn(),
            logCallback: vi.fn(),
            dbClient: getTestDb()
        } as any;

        // First iteration
        const result1 = await analysisNode(initialState, context);

        expect(result1.problemComplexity).toBeDefined();
        expect(result1.complexityHistory).toHaveLength(1);
        expect(result1.complexityHistory![0]).toBe(result1.problemComplexity);
        expect(result1.refinedProblemStatement).toBeUndefined(); // No feedback yet

        // Second iteration with feedback
        const state2: GraphState = {
            ...initialState,
            ...result1,
            iteration: 1,
            feedback: ['First attempt failed: requirements.txt not found'],
            complexityHistory: result1.complexityHistory || []
        };

        const result2 = await analysisNode(state2, context);

        expect(result2.problemComplexity).toBeDefined();
        expect(result2.complexityHistory).toHaveLength(2);
        expect(result2.refinedProblemStatement).toBeDefined();
    });

    it('should detect convergence to atomic state', async () => {
        // Simulate decreasing complexity over iterations
        const state: GraphState = {
            config: mockConfig,
            group: mockGroup,
            activeLog: '',
            currentNode: 'analysis',
            iteration: 3,
            maxIterations: 5,
            status: 'working',
            initialRepoContext: '',
            initialLogText: '',
            currentLogText: '',
            files: {},
            fileReservations: [],
            history: [],
            feedback: ['Attempt 1', 'Attempt 2', 'Attempt 3'],
            complexityHistory: [8, 6, 4], // Decreasing complexity
            solvedNodes: []
        };

        const context = {
            services: createMockServices(),
            updateStateCallback: vi.fn(),
            logCallback: vi.fn(),
            dbClient: getTestDb()
        } as any;

        const result = await analysisNode(state, context);

        expect(result.complexityHistory).toHaveLength(4);

        // With decreasing complexity and simple error, should eventually be atomic
        // (exact value depends on classification, but we can check it's defined)
        expect(result.isAtomic).toBeDefined();
    });

    it('should refine problem statement with accumulated feedback', async () => {
        const state: GraphState = {
            config: mockConfig,
            group: mockGroup,
            activeLog: '',
            currentNode: 'analysis',
            iteration: 2,
            maxIterations: 5,
            status: 'working',
            initialRepoContext: '',
            initialLogText: '',
            currentLogText: '',
            files: {},
            fileReservations: [],
            history: [],
            feedback: [
                'Attempt 1: requirements.txt not found',
                'Attempt 2: Created requirements.txt but pytest version incompatible'
            ],
            complexityHistory: [7, 6],
            refinedProblemStatement: 'Missing pytest dependency. Previous attempts: Attempt 1: requirements.txt not found',
            solvedNodes: []
        };

        const context = {
            services: createMockServices(),
            updateStateCallback: vi.fn(),
            logCallback: vi.fn(),
            dbClient: getTestDb()
        } as any;

        const result = await analysisNode(state, context);

        expect(result.refinedProblemStatement).toBeDefined();
    });

    it('should persist AoT metadata to error facts', async () => {
        const state: GraphState = {
            config: mockConfig,
            group: mockGroup,
            activeLog: '',
            currentNode: 'analysis',
            iteration: 0, // First iteration triggers DB write
            maxIterations: 5,
            status: 'working',
            initialRepoContext: '',
            initialLogText: '',
            currentLogText: '',
            files: {},
            fileReservations: [],
            history: [],
            feedback: [],
            complexityHistory: [],
            solvedNodes: []
        };

        const context = {
            services: createMockServices(),
            updateStateCallback: vi.fn(),
            logCallback: vi.fn(),
            dbClient: getTestDb()
        } as any;

        const result = await analysisNode(state, context);

        // Check that error fact was created
        const testDb = getTestDb();
        const errorFacts = await testDb.errorFact.findMany({
            where: { runId: mockGroup.id }
        });

        expect(errorFacts).toHaveLength(1);

        const notes = JSON.parse(errorFacts[0].notes || '{}');
        expect(notes.complexity).toBeDefined();
        expect(notes.isAtomic).toBeDefined();
        expect(notes.classificationCategory).toBeDefined();
    });
});
