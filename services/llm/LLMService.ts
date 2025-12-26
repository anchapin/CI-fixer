
import { GoogleGenAI } from "@google/genai";
import { AppConfig } from '../../types.js';
import { withSpan, setAttributes, addEvent } from '../../telemetry/tracing.js';
import { recordLLMCall } from '../../telemetry/metrics.js';

// Constants
const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-3-pro-preview";

// Helper: Retry Logic with Exponential Backoff
export async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (e: any) {
            lastError = e;
            // Stop retrying if the error explicitly says so
            if (e.noRetry || e.name === 'AbortError') throw e;

            const delay = baseDelay * Math.pow(2, i);
            console.warn(`[Retry] Attempt ${i + 1}/${retries} failed. Retrying in ${delay}ms...`, e.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

// Helper: Extract code from markdown
export function extractCode(text: string, language: string = 'text'): string {
    // We can't import from utils/parsing here easily if it's a cyclic dependency or different layer,
    // but we can use the same logic.

    const startMarker = '```';
    const firstIndex = text.indexOf(startMarker);

    if (firstIndex !== -1) {
        const openingFenceEnd = firstIndex + startMarker.length;
        const closingMarkerIndex = text.indexOf(startMarker, openingFenceEnd);

        if (closingMarkerIndex !== -1) {
            const contentWithInfo = text.substring(openingFenceEnd, closingMarkerIndex);
            const newlineIndex = contentWithInfo.indexOf('\n');

            if (newlineIndex !== -1) {
                return contentWithInfo.substring(newlineIndex + 1).trim();
            } else {
                return contentWithInfo.trim();
            }
        }
    }

    // Fallback if no backticks found
    return text.trim();
}

// Helper: Safe JSON Parse with aggressive cleanup
export function safeJsonParse<T>(text: string, fallback: T): T {
    try {
        // 1. Try standard extraction from code blocks
        const jsonMatch = text.match(/```json([\s\S]*?)```/) || text.match(/```([\s\S]*?)```/);
        let jsonStr = jsonMatch ? jsonMatch[1] : text;

        // 2. Aggressive cleanup: remove non-JSON prefix/suffix if model chatted outside blocks
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }

        return JSON.parse(jsonStr) as T;
    } catch (e) {
        console.warn("JSON Parse Failed for text:", text.substring(0, 100));
        return fallback;
    }
}

// ToolOrchestra: LLM Call Metrics
export interface LLMCallMetrics {
    tokensInput: number;
    tokensOutput: number;
    cost: number;
    latency: number;
    model: string;
}

/**
 * Estimate token count from text (rough approximation)
 * Rule of thumb: 1 token ≈ 4 characters
 */
function estimateTokens(text: string | any): number {
    const str = typeof text === 'string' ? text : JSON.stringify(text);
    return Math.ceil(str.length / 4);
}

/**
 * Calculate cost based on model and token counts
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Cost per 1K tokens (approximate)
    const costs: Record<string, { input: number; output: number }> = {
        'gemini-3-pro-preview': { input: 0.01, output: 0.03 },
        'gemini-2.5-flash': { input: 0.001, output: 0.003 },
        'GLM-4.7': { input: 0.005, output: 0.015 },
        'gpt-4o': { input: 0.005, output: 0.015 }
    };

    const modelCosts = costs[model] || costs['gemini-2.5-flash'];
    return (inputTokens / 1000 * modelCosts.input) + (outputTokens / 1000 * modelCosts.output);
}


// Core LLM Wrapper
export async function unifiedGenerate(config: AppConfig, params: {
    model?: string,
    contents: any,
    config?: any,
    responseFormat?: 'json' | 'text',
    validate?: (text: string) => boolean
}): Promise<{ text: string, toolCalls?: any[], metrics?: LLMCallMetrics }> {
    const startTime = Date.now();

    // 1. Handle Z.AI / OpenAI Providers via Fetch
    if (config.llmProvider === 'zai' || config.llmProvider === 'openai') {
        const isZai = config.llmProvider === 'zai';
        // Use dedicated Coding Plan endpoint for Z.ai
        const baseUrl = config.llmBaseUrl || (isZai ? 'https://api.z.ai/api/coding/paas/v4' : 'https://api.openai.com/v1');
        const rawApiKey = config.customApiKey || "dummy_key";
        const apiKey = rawApiKey;

        // Map Gemini constants to provider defaults if needed
        let model = config.llmModel || (isZai ? "GLM-4.7" : "gpt-4o");

        if (params.model && !params.model.startsWith('gemini-')) {
            model = params.model;
        }

        const messages = typeof params.contents === 'string'
            ? [{ role: 'user', content: params.contents }]
            : Array.isArray(params.contents) ? params.contents : [{ role: 'user', content: JSON.stringify(params.contents) }];

        return retryWithBackoff(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), (config as any).llmTimeout || 300000); // Default 300s (5m)

            try {
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'User-Agent': 'CI-Fixer/1.0.0 (compatible; Z.ai-DevPack)'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        temperature: params.config?.temperature || 0.1
                    }),
                    signal: controller.signal
                });

                if (!response.ok) {
                    const errText = await response.text();
                    if (response.status >= 500 || response.status === 429) {
                        throw new Error(`Provider API Server/Rate Error ${response.status}: ${errText}`);
                    }
                    const clientError: any = new Error(`Provider API Client Error ${response.status}: ${errText}`);
                    clientError.noRetry = true;
                    throw clientError;
                }
                const data = await response.json();
                const text = data.choices?.[0]?.message?.content || "";

                // Validation Hook
                if (params.validate && !params.validate(text)) {
                    throw new Error(`Output validation failed for provider ${config.llmProvider}`);
                }

                return {
                    text,
                    toolCalls: data.choices?.[0]?.message?.tool_calls,
                    metrics: {
                        tokensInput: estimateTokens(params.contents),
                        tokensOutput: estimateTokens(text),
                        cost: 0,
                        latency: Date.now() - startTime,
                        model
                    }
                };
            } finally {
                clearTimeout(timeoutId);
            }
        }, 5, 2000).catch(e => {
            if (e.name === 'AbortError' || e.message === 'AbortError') {
                throw new Error(`LLM Generation Timed Out after ${(config as any).llmTimeout || 300000}ms`);
            }
            throw new Error(`LLM Generation Failed after retries: ${e.message}`);
        });
    }

    // 2. Default: Google GenAI SDK
    const apiKey = config.customApiKey || process.env.API_KEY || "dummy_key";
    const maxRetries = 3;
    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
        const genAI = new GoogleGenAI({ apiKey });
        const modelName = params.model || config.llmModel || MODEL_SMART;

        try {
            // Add JSON mode support for Gemini
            const generationConfig = params.responseFormat === 'json'
                ? { ...params.config, responseMimeType: 'application/json' }
                : params.config;

            const response = await genAI.models.generateContent({
                model: modelName,
                contents: params.contents,
                config: generationConfig
            });

            const text = response.text || "";

            // Validation Hook
            if (params.validate && !params.validate(text)) {
                console.warn(`[unifiedGenerate] Validation failed on attempt ${i + 1}. Retrying...`);
                lastError = new Error("Output validation failed");
                continue;
            }

            const candidate = response.candidates?.[0];
            const functionCalls = candidate?.content?.parts?.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);

            // Calculate metrics
            const latency = Date.now() - startTime;
            const tokensInput = estimateTokens(params.contents);
            const tokensOutput = estimateTokens(text);
            const metrics: LLMCallMetrics = {
                tokensInput,
                tokensOutput,
                cost: calculateCost(modelName, tokensInput, tokensOutput),
                latency,
                model: modelName
            };

            return {
                text,
                toolCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined,
                metrics
            };
        } catch (error: any) {
            lastError = error;

            if (error.status === 404 || error.message?.includes('not found')) {
                console.warn(`Model ${modelName} not found, falling back to ${MODEL_FAST}`);
                try {
                    const fallback = await genAI.models.generateContent({
                        model: MODEL_FAST,
                        contents: params.contents,
                        config: params.config
                    });

                    const text = fallback.text || "";
                    const latency = Date.now() - startTime;
                    const tokensInput = estimateTokens(params.contents);
                    const tokensOutput = estimateTokens(text);
                    const metrics: LLMCallMetrics = {
                        tokensInput,
                        tokensOutput,
                        cost: calculateCost(MODEL_FAST, tokensInput, tokensOutput),
                        latency,
                        model: MODEL_FAST
                    };

                    return { text, metrics };
                } catch (fbError) {
                    throw new Error(`Fallback Model Failed: ${fbError}`);
                }
            }

            if (error.status === 429 || error.status === 503 || error.message?.includes('Overloaded')) {
                const delay = 1000 * Math.pow(2, i);
                console.warn(`[Gemini] Error ${error.status}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            break;
        }
    }

    throw new Error(`LLM Generation Failed after retries: ${lastError?.message || 'Unknown Error'}`);
}
