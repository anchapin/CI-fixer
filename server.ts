import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AgentState, AgentPhase, AppConfig, RunGroup, LogLine } from './types.js';
import { runIndependentAgentLoop } from './agent.js';

dotenv.config({ path: '.env.local' });

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// In-Memory Store
const agents = new Map<string, AgentState>();
const abortControllers = new Map<string, AbortController>();

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start Agent
app.post('/api/agent/start', async (req, res) => {
    try {
        const { config, group, initialRepoContext } = req.body as {
            config: AppConfig,
            group: RunGroup,
            initialRepoContext: string
        };

        if (!config || !group) {
            return res.status(400).json({ error: 'Missing config or group' });
        }

        const agentId = group.id;

        // Initialize State
        const initialState: AgentState = {
            groupId: agentId,
            name: group.name,
            phase: AgentPhase.IDLE,
            iteration: 0,
            status: 'working',
            files: {},
            fileReservations: [],
            activeLog: ''
        };
        agents.set(agentId, initialState);

        // Start Loop in Background
        // Note: In a real prod app, use a proper job queue (Bull/Redis)
        const updateCallback = (id: string, partial: Partial<AgentState>) => {
            const current = agents.get(id);
            if (current) {
                agents.set(id, { ...current, ...partial });
            }
        };

        const logCallback = (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => {
            console.log(`[AGENT:${agentName}] ${level}: ${content}`);
            // Logs are appended to activeLog in the agent loop usually, 
            // but we can also store them here if we want a separate log store.
        };

        // Run asynchronously
        runIndependentAgentLoop(
            config,
            group,
            initialRepoContext,
            updateCallback,
            logCallback
        ).then(finalState => {
            agents.set(agentId, finalState);
            console.log(`[AGENT:${group.name}] Finished with status: ${finalState.status}`);
        }).catch(err => {
            console.error(`[AGENT:${group.name}] Crashed:`, err);
            const current = agents.get(agentId);
            if (current) agents.set(agentId, { ...current, status: 'failed', message: err.message });
        });

        res.json({ agentId, status: 'started' });

    } catch (e: any) {
        console.error('Failed to start agent:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get Agent Status
app.get('/api/agent/:id', (req, res) => {
    const state = agents.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'Agent not found' });
    res.json(state);
});

// Stop Agent
app.post('/api/agent/:id/stop', (req, res) => {
    // Implementing "Stop" is tricky with promises unless we pass an AbortSignal
    // For now, we will just mark status as failed/cancelled
    const state = agents.get(req.params.id);
    if (state) {
        agents.set(req.params.id, { ...state, status: 'failed', message: 'User Cancelled' });
    }
    res.json({ status: 'stopped' });
});

// Proxy for E2B (if we still need to support browser-based execution for legacy reasons, 
// strictly speaking we don't need this if we move everything to server, but good for hybrid)
app.all(/^\/api\/e2b\/.*/, async (req, res) => {
    // Simple proxy if needed, otherwise ignore.
    res.status(501).send('Use server-side agents');
});

app.listen(PORT, () => {
    console.log(`CI-Fixer Backend running on http://localhost:${PORT}`);
});
