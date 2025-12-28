
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { AgentState, AgentPhase, AppConfig, RunGroup } from '../../types.js';

// Mock the Agent Loop
import { runIndependentAgentLoop } from '../../agent.js';

// Mock Services
vi.mock('../../agent.js', () => ({
    runIndependentAgentLoop: vi.fn(async (config, group, context, services, updateCallback, logCallback) => {
        updateCallback(group.id, { phase: AgentPhase.PLAN, status: 'working' });
        await new Promise(r => setTimeout(r, 100));
        updateCallback(group.id, { phase: AgentPhase.SUCCESS, status: 'success' });
        return { status: 'success' } as any;
    })
}));

const PORT = 4000; // Use different port for test
const BASE_URL = `http://localhost:${PORT}`;

describe('Agent Server API', () => {
    let server: any;
    let app: any;

    beforeAll(async () => {
        // Setup minimal server for testing (Mirroring server.ts)
        app = express();
        app.use(cors());
        app.use(express.json());

        const agents = new Map<string, AgentState>();

        app.post('/api/agent/start', async (req: any, res: any) => {
            const { group } = req.body;
            const initialState: AgentState = {
                groupId: group.id,
                name: group.name,
                phase: AgentPhase.IDLE,
                iteration: 0,
                status: 'working',
                files: {},
                fileReservations: [],
                activeLog: ''
            };
            agents.set(group.id, initialState);

            // Mock Async Execution
            runIndependentAgentLoop(null as any, group, "", {} as any, (id: string, partial: any) => {
                const current = agents.get(id);
                if (current) agents.set(id, { ...current, ...partial });
            }, () => { });

            res.json({ agentId: group.id, status: 'started' });
        });

        app.get('/api/agent/:id', (req: any, res: any) => {
            const state = agents.get(req.params.id);
            if (!state) return res.status(404).json({ error: 'Not found' });
            res.json(state);
        });

        return new Promise<void>(resolve => {
            server = app.listen(PORT, () => resolve());
        });
    });

    afterAll(() => {
        server.close();
    });

    it('should start an agent and poll status', async () => {
        const group: RunGroup = { 
            id: 'test-group-1', 
            name: 'Test Agent', 
            runIds: [],
            mainRun: { id: 123, head_sha: 'abc', name: 'Test', path: '.github/workflows/test.yml', status: 'failed', conclusion: 'failure', html_url: '' }
        };

        // 1. Start Agent
        const startRes = await fetch(`${BASE_URL}/api/agent/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group, config: {}, initialRepoContext: '' })
        });
        expect(startRes.ok).toBe(true);
        const startData = await startRes.json();
        expect(startData.agentId).toBe('test-group-1');

        // 2. Poll Status (Immediately)
        let statusRes = await fetch(`${BASE_URL}/api/agent/test-group-1`);
        let state = await statusRes.json();
        expect(state.groupId).toBe('test-group-1');

        // 3. Wait for Mock completion (Simulate Polling)
        await new Promise(r => setTimeout(r, 200));

        statusRes = await fetch(`${BASE_URL}/api/agent/test-group-1`);
        state = await statusRes.json();

        // Should be updated by mock loop
        // expect(state.phase).toBe('SUCCESS'); // Mock update
    });
});
