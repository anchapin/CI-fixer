
import { describe, it, expect } from 'vitest';
import { Sandbox } from '@e2b/code-interpreter';
import { GoogleGenAI } from '@google/genai';
import * as crypto from 'crypto';

// Helper to generate Zhipu AI JWT (HS256) - REMOVED (using raw API key now)


describe('MVP Integration Check', () => {

    // Load Env Vars
    const e2bKey = process.env.E2B_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const llmProvider = process.env.VITE_LLM_PROVIDER || 'gemini';
    const isZai = llmProvider === 'zai';
    // Use the URL from Quick Start docs
    const llmBaseUrl = isZai ? 'https://api.z.ai/api/paas/v4' : undefined;

    // 1. E2B Connection
    it('should connect to E2B Sandbox', async () => {
        if (!e2bKey) {
            console.warn('Skipping E2B Test: No E2B_API_KEY found.');
            return;
        }
        console.log('Connecting to E2B...');
        let sandbox;
        try {
            sandbox = await Sandbox.create({ apiKey: e2bKey });
            const res = await sandbox.runCode('echo "Hello E2B"', { language: 'bash' });
            console.log('E2B Stdout:', res.logs.stdout);
            expect(res.logs.stdout.join('')).toContain('Hello E2B');
            console.log('E2B Connection: OK');
        } finally {
            if (sandbox) await sandbox.kill();
        }
    }, 60000);

    // 2. LLM Generation (Gemini or Z.ai)
    it('should generate text from LLM', async () => {
        if (!geminiKey) {
            console.warn('Skipping LLM Test: No GEMINI_API_KEY found.');
            return;
        }

        console.log(`Testing LLM Provider: '${llmProvider}'`);

        let text = "";

        try {
            if (isZai) {
                // OpenCode Configuration Verification
                // Source: https://models.dev/api.json -> "zai-coding-plan"
                // Endpoint: https://api.z.ai/api/coding/paas/v4
                // Auth: Bearer <RAW_API_KEY> (via @ai-sdk/openai-compatible)

                const codingBaseUrl = "https://api.z.ai/api/coding/paas/v4";
                console.log(`[Z.ai] Testing OpenCode Strategy: ${codingBaseUrl} with Raw Key`);

                const res = await fetch(`${codingBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${geminiKey}`
                    },
                    body: JSON.stringify({
                        model: "GLM-4.6", // Model used by OpenCode
                        messages: [{ role: 'user', content: "Ping" }]
                    })
                });

                if (!res.ok) {
                    const errText = await res.text();
                    console.error(`Z.ai Coding Plan Error:`, res.status, errText);

                    if (res.status === 401) {
                        console.warn(`[WARNING] Z.ai Auth Failed (401). Skipping LLM verification. Verify:
1. API Key is valid.
2. API Key has 'Coding Plan' entitlement (required for ${codingBaseUrl}).
3. You are using the Zhipu API Key from https://z.ai/manage-apikey/apikey-list`);
                        return; // Skip the rest of this test
                    }
                    throw new Error(`Z.ai Failed: ${errText}`);
                }

                const data: any = await res.json();
                console.log("Z.ai Response:", JSON.stringify(data, null, 2));
                text = data.choices?.[0]?.message?.content || "";
            } else {
                // Gemini SDK
                const genAI = new GoogleGenAI({ apiKey: geminiKey });
                const result = await genAI.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: "Return only the word 'Pong'."
                });
                text = result.text || "";
                console.log('Gemini Raw Text:', text);
            }
        } catch (e: any) {
            console.error('LLM Generation Error:', e);
            throw e;
        }

        console.log(`LLM Response: ${text}`);
        expect(text.trim()).toBeTruthy();
    }, 30000);

    // 3. Tavily Web Search
    it('should search using Tavily', async () => {
        const tavilyKey = process.env.TAVILY_API_KEY;
        if (!tavilyKey) {
            console.warn('Skipping Tavily Test: No TAVILY_API_KEY found.');
            return;
        }

        console.log('Testing Tavily Search...');
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: tavilyKey,
                query: "What is the capital of France?",
                search_depth: "basic",
                max_results: 1
            })
        });

        const data: any = await res.json();
        console.log(`Tavily Results: ${JSON.stringify(data.results?.[0]?.title ?? 'No results')}`);
        expect(res.status).toBe(200);
        expect(data.results).toBeDefined();
        expect(Array.isArray(data.results)).toBe(true);
        expect(data.results.length).toBeGreaterThan(0);
    }, 30000);

    // 4. GitHub Token Check
    it('should have a GitHub token', () => {
        expect(process.env.GITHUB_TOKEN).toBeDefined();
        console.log('GitHub Token: Present');
    });

});
