
import { AppConfig, GenerateContentResult } from '../../types.js';

export class MockLLMService {
    private responseQueue: string[] = [];
    private customHandler: ((prompt: string) => string) | null = null;
    public callHistory: string[] = [];

    /**
     * Stacks a response to be returned by the next call.
     */
    public queueResponse(response: string) {
        this.responseQueue.push(response);
    }

    /**
     * Sets a custom handler to generate responses dynamically.
     */
    public setHandler(handler: (prompt: string) => string) {
        this.customHandler = handler;
    }

    public clear() {
        this.responseQueue = [];
        this.callHistory = [];
        this.customHandler = null;
    }

    // ============================================
    // Mocked Service Methods
    // ============================================

    public unifiedGenerate = async (config: AppConfig, params: any): Promise<GenerateContentResult> => {
        const prompt = typeof params.contents === 'string' ? params.contents : JSON.stringify(params.contents);
        console.error(`[MockLLM] Received Prompt (${prompt.length} chars): ${prompt.slice(0, 100)}...`);
        this.callHistory.push(prompt);

        if (this.customHandler) {
            const text = this.customHandler(prompt);
            console.error(`[MockLLM] Returning Custom Response: ${text.slice(0, 100)}...`);
            return { text };
        }

        if (this.responseQueue.length > 0) {
            const text = this.responseQueue.shift()!;
            console.error(`[MockLLM] Returning Queued Response: ${text.slice(0, 100)}...`);
            return { text };
        }

        console.error(`[MockLLM] Queue Empty! Returning Default.`);

        // Check if this looks like a code generation request to return appropriate format
        if (prompt.includes('instruction') && (prompt.includes('Return only the full file code') || prompt.includes('Return only the complete file code'))) {
            // This is likely a generateFix call, return code in markdown format
            return {
                text: "```typescript\n// Mock default code\nconsole.log('default');\n```"
            };
        } else if (prompt.includes('judge') || prompt.includes('Judge') || prompt.includes('passed') || (prompt.includes('verification') && prompt.includes('result'))) {
            // This is likely a judgeFix or verification call - always return success to prevent infinite loops
            return {
                text: JSON.stringify({
                    passed: true,
                    score: 10,
                    reasoning: "Mock judge passed - test verification succeeded"
                })
            };
        } else if (prompt.includes('diagnos') || prompt.includes('summary') || prompt.includes('error') || prompt.includes('fix')) {
            // This is likely a diagnosis call
            return {
                text: JSON.stringify({
                    summary: "Mock Diagnosis",
                    filePath: "src/file.ts",
                    fixAction: "edit",
                    passed: true,
                    score: 10,
                    reasoning: "Mock diagnosis response"
                })
            };
        } else if (prompt.includes('goal') || prompt.includes('task') || prompt.includes('plan')) {
            // This is likely a planning call
            return {
                text: JSON.stringify({
                    goal: "Mock Goal",
                    tasks: [],
                    approved: true
                })
            };
        } else {
            // Default response for any other type of call
            return {
                text: JSON.stringify({
                    summary: "Mock Response",
                    filePath: "src/default.ts",
                    fixAction: "edit",
                    passed: true,
                    score: 10,
                    reasoning: "Default mock response to prevent infinite loops"
                })
            };
        }
    };

    public safeJsonParse = <T>(text: string, fallback: T): T => {
        try {
            // Basic cleanup commonly done in the real service
            const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(clean);
        } catch {
            return fallback;
        }
    };

    public extractCode = (text: string, lang?: string): string => {
        return text.replace(/```[\w]*\n/g, '').replace(/```/g, '').trim();
    };

    public retryWithBackoff = async <T>(fn: () => Promise<T>): Promise<T> => {
        return fn();
    }
}
