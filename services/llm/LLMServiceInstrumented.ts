/**
 * Instrumented wrapper for LLM service
 * Adds distributed tracing and metrics to LLM calls
 */

import { AppConfig } from '../../types.js';
import { unifiedGenerate as baseUnifiedGenerate } from './LLMService.js';
import { withSpan, setAttributes, addEvent } from '../../telemetry/tracing.js';
import { recordLLMCall } from '../../telemetry/metrics.js';

/**
 * Instrumented version of unifiedGenerate
 * Wraps the base function with tracing and metrics
 */
export async function unifiedGenerateInstrumented(
    config: AppConfig,
    params: { model?: string, contents: any, config?: any, responseFormat?: 'json' | 'text' }
): Promise<{ text: string, toolCalls?: any[] }> {
    return withSpan('llm-generate', async (span) => {
        const provider = config.llmProvider || 'gemini';
        const model = params.model || config.llmModel || 'gemini-3-pro-preview';
        const startTime = Date.now();

        setAttributes(span, {
            'llm.provider': provider,
            'llm.model': model,
            'llm.temperature': params.config?.temperature || 0.1,
            'llm.response_format': params.responseFormat || 'text',
            'llm.prompt_length': JSON.stringify(params.contents).length
        });

        try {
            const response = await baseUnifiedGenerate(config, params);

            // Record metrics and attributes
            const duration = Date.now() - startTime;
            const responseLength = response.text.length;
            const estimatedTokens = Math.ceil((JSON.stringify(params.contents).length + responseLength) / 4);

            setAttributes(span, {
                'llm.response_length': responseLength,
                'llm.duration_ms': duration,
                'llm.tokens_estimated': estimatedTokens,
                'llm.success': true
            });

            addEvent(span, 'llm-response-received', {
                duration_ms: duration,
                response_preview: response.text.substring(0, 100)
            });

            // Record metrics
            recordLLMCall(provider, model, estimatedTokens, duration, true);

            return response;

        } catch (error: any) {
            const duration = Date.now() - startTime;

            setAttributes(span, {
                'llm.error': error.message,
                'llm.duration_ms': duration,
                'llm.success': false
            });

            addEvent(span, 'llm-error', {
                error: error.message,
                provider,
                model
            });

            // Record failed call
            recordLLMCall(provider, model, 0, duration, false);

            throw error;
        }
    }, {
        attributes: {
            'component': 'llm-service'
        }
    });
}

// Export both versions for gradual migration
export { unifiedGenerate } from './LLMService.js';
