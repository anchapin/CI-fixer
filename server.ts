import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AgentState, AgentPhase, AppConfig, RunGroup, LogLine } from './types.js';
import { runIndependentAgentLoop } from './agent.js';

dotenv.config({ path: '.env.local' });

// Initialize OpenTelemetry if enabled
import { initTelemetry } from './telemetry/config.js';
if (process.env.OTEL_EXPORTER_FILE || process.env.OTEL_EXPORTER_CONSOLE) {
    initTelemetry('ci-fixer-server');
}

const app = express();
app.use(cors());
app.use(express.json());

import { chat, toStreamResponse } from '@tanstack/ai';
import { CIMultiAdapter } from './services/CIMultiAdapter.js';
import { createTools } from './services/sandbox/SandboxService.js';
import { defaultServices } from './services/container.js';

const PORT = 3001;

import { db } from './db/client.js';

// In-Memory Store (for AbortControllers only)
const abortControllers = new Map<string, AbortController>();

// Initialize Adapter
// Note: We use process.env to populate AppConfig. 
// In a real app we might want per-request config, but the adapter stores it.
// We'll create a default config from env.
const defaultAdapterConfig: AppConfig = {
    repoUrl: '',
    githubToken: process.env.GITHUB_TOKEN || '',
    llmProvider: (process.env.LLM_PROVIDER as any) || 'google',
    llmModel: process.env.LLM_MODEL || 'gemini-3-pro-preview',
    llmBaseUrl: process.env.LLM_BASE_URL,
    customApiKey: process.env.API_KEY || process.env.OPENAI_API_KEY || "dummy",
    tavilyApiKey: process.env.TAVILY_API_KEY,
    devEnv: 'simulation',
    checkEnv: 'simulation',
    selectedRuns: []
};
const adapter = new CIMultiAdapter(defaultAdapterConfig);

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

        // Create DB Entry
        await db.agentRun.create({
            data: {
                id: agentId,
                groupId: agentId,
                status: 'working',
                state: JSON.stringify(initialState)
            }
        });

        // Start Loop in Background
        let localState = initialState;

        const updateCallback = async (id: string, partial: Partial<AgentState>) => {
            localState = { ...localState, ...partial };
            try {
                await db.agentRun.update({
                    where: { id },
                    data: {
                        state: JSON.stringify(localState),
                        status: localState.status
                    }
                });
            } catch (e) {
                console.error(`[DB] Failed to update state for ${id}:`, e);
            }
        };

        const logCallback = (level: LogLine['level'], content: string, agentId?: string, agentName?: string) => {
            console.log(`[AGENT:${agentName}] ${level}: ${content}`);
            // Logs are persisted via updateCallback (activeLog)
        };



        // Run asynchronously
        runIndependentAgentLoop(
            config,
            group,
            initialRepoContext,
            defaultServices,
            updateCallback,
            logCallback
        ).then(async finalState => {
            await db.agentRun.update({
                where: { id: agentId },
                data: {
                    status: finalState.status,
                    state: JSON.stringify(finalState)
                }
            });
            console.log(`[AGENT:${group.name}] Finished with status: ${finalState.status}`);
        }).catch(async err => {
            console.error(`[AGENT:${group.name}] Crashed:`, err);
            await db.agentRun.update({
                where: { id: agentId },
                data: {
                    status: 'failed'
                    // We'd ideally start updating state with error message, 
                    // but we can trust runIndependentAgentLoop calls updateCallback with error info before throwing?
                    // Actually, supervisor catches and returns state. So .catch here is for truly catastrophic failures.
                }
            });
        });

        res.json({ agentId, status: 'started' });

    } catch (e: any) {
        console.error('Failed to start agent:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get Agent Status
app.get('/api/agent/:id', async (req, res) => {
    try {
        const run = await db.agentRun.findUnique({ where: { id: req.params.id } });
        if (!run) return res.status(404).json({ error: 'Agent not found' });

        const state = JSON.parse(run.state);
        res.json(state);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Stop Agent
app.post('/api/agent/:id/stop', async (req, res) => {
    try {
        await db.agentRun.update({
            where: { id: req.params.id },
            data: { status: 'stopped' } // Logic to actually stop via AbortController is pending
        });
        res.json({ status: 'stopped' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// METRICS ENDPOINTS
// ============================================================================

import { getMetricsSummary, getMetricsByCategory, getRecentMetrics } from './services/metrics.js';

app.get('/api/metrics/summary', async (req, res) => {
    try {
        const summary = await getMetricsSummary();
        res.json(summary);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/metrics/by-category/:category', async (req, res) => {
    try {
        const metrics = await getMetricsByCategory(req.params.category);
        res.json(metrics);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/metrics/recent', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const recent = await getRecentMetrics(limit);
        res.json(recent);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// KNOWLEDGE BASE ENDPOINTS
// ============================================================================

import { getTopFixPatterns, generateErrorFingerprint } from './services/knowledge-base.js';
import { db as prisma } from './db/client.js';

app.get('/api/knowledge-base/patterns', async (req, res) => {
    try {
        const patterns = await getTopFixPatterns(50);
        res.json(patterns);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/knowledge-base/match', async (req, res) => {
    try {
        const { errorCategory, errorMessage, files } = req.query;

        if (!errorCategory || !errorMessage) {
            return res.status(400).json({ error: 'Missing errorCategory or errorMessage' });
        }

        const fingerprint = generateErrorFingerprint(
            errorCategory as string,
            errorMessage as string,
            files ? (files as string).split(',') : []
        );

        const matches = await prisma.fixPattern.findMany({
            where: { errorFingerprint: fingerprint }
        });
        res.json(matches);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// ACTION LIBRARY ENDPOINTS
// ============================================================================

import { getSuggestedActions, addActionTemplate, getActionTemplates } from './services/action-library.js';
import { classifyError } from './errorClassification.js';

app.get('/api/actions/suggest', async (req, res) => {
    try {
        const { logs, filePath } = req.query;

        if (!logs || !filePath) {
            return res.status(400).json({ error: 'Missing logs or filePath' });
        }

        const classified = classifyError(logs as string);
        const suggestions = await getSuggestedActions(classified, filePath as string, 3);
        res.json(suggestions);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/actions/templates', async (req, res) => {
    try {
        const { errorCategory } = req.query;
        const templates = await getActionTemplates(errorCategory as string | undefined);
        res.json(templates);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/actions/template', async (req, res) => {
    try {
        const { errorCategory, filePattern, actionType, template } = req.body;

        if (!errorCategory || !filePattern || !actionType || !template) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const newTemplate = await addActionTemplate(
            errorCategory,
            filePattern,
            actionType,
            template
        );
        res.json(newTemplate);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// TanStack AI Chat Endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        // The SDK's `chat` function returns a stream.
        // We need to pipe it to the response.
        const toolsMap = createTools(defaultAdapterConfig);
        const tools = Object.values(toolsMap);

        const systemMessage = {
            role: 'system',
            content: `You are an advanced Coding Agent with access to a 'Code Mode' sandbox.
You have access to a TypeScript library \`agent_tools\` (pre-imported) with the following async functions:
- \`readFile(path: string): Promise<string>\`
- \`writeFile(path: string, content: string): Promise<string>\`
- \`runCmd(command: string): Promise<string>\`
- \`search(query: string): Promise<string[]>\`
- \`listDir(path: string): Promise<string[]>\`

You MUST use the \`run_code_mode_script\` tool for ALL file operations, searching, and command executions.
When asked to investigate or fix something, write a TypeScript script using these tools.
Example:
\`\`\`typescript
const files = await agent_tools.listDir('.');
console.log(files);
\`\`\`
`
        };

        const finalMessages = [systemMessage, ...messages];

        const stream = await chat({
            adapter,
            model: 'gemini-3-pro-preview',
            messages: finalMessages,
            tools
        });

        // toStreamResponse usually returns a Response object (Web Standard).
        // We need to convert it to Node's stream or pipe it.
        const response = toStreamResponse(stream);

        // Propagate headers
        response.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });

        // Pipe body
        if (response.body) {
            // @ts-ignore - Readable.fromWeb matches Response.body but Types might be old
            const nodeStream = (response.body as any).pipe ? response.body : require('stream').Readable.fromWeb(response.body);
            nodeStream.pipe(res);
        } else {
            res.end();
        }

    } catch (e: any) {
        console.error('Chat endpoint error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`CI-Fixer Backend running on http://localhost:${PORT}`);
});
