
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
        // Return valid JSON that works for both diagnosis AND judge calls
        return {
            text: JSON.stringify({
                summary: "Mock Diagnosis",
                filePath: "src/file.ts",
                fixAction: "edit",
                passed: true,
                score: 10,
                reasoning: "Mock default response"
            })
        };
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
