
import { AIAdapter, Modality, StreamChunk } from '@tanstack/ai';
import { unifiedGenerate } from './llm/LLMService.js';
import { AppConfig } from '../types.js';

// Generic Any used to bypass strict interface constraints for initial integration
export class CIMultiAdapter implements AIAdapter<any, any, any, any, any, any, any> {
    name = "ci-multi-adapter";
    models: any = ["gemini-2.5-flash", "gemini-3-pro-preview", "gpt-4o"];
    _modelProviderOptionsByName = {};
    _modelInputModalitiesByName = {};
    _messageMetadataByModality = {
        text: {},
        image: {},
        audio: {},
        video: {},
        document: {}
    };

    constructor(private config: AppConfig) { }

    async *chatStream(options: any): AsyncIterable<StreamChunk> {
        const messageId = 'msg-' + Date.now();
        const baseChunk = {
            id: messageId,
            model: options.model || "gemini-3-pro-preview",
            timestamp: Date.now()
        };

        try {
            const result = await unifiedGenerate(this.config, {
                model: options.model,
                contents: options.messages.map((m: any) => ({
                    role: m.role,
                    content: m.content
                }))
            });

            // Start
            yield {
                ...baseChunk,
                type: 'start',
                messageId
            } as any;

            // Content
            if (result.text) {
                yield {
                    ...baseChunk,
                    type: 'content',
                    delta: result.text,
                    content: result.text
                } as any;
            }

            // Tool Calls
            if (result.toolCalls) {
                for (const call of result.toolCalls) {
                    yield {
                        ...baseChunk,
                        type: 'tool-call',
                        toolCall: {
                            id: call.id || `call-${Date.now()}`,
                            type: 'function',
                            function: {
                                name: call.function?.name || call.name, // Handle varied provider formats
                                arguments: call.function?.arguments || JSON.stringify(call.args) || "{}"
                            }
                        }
                    } as any;
                }
            }

            // End
            yield {
                ...baseChunk,
                type: 'end'
            } as any;

        } catch (e: any) {
            console.error("Adapter Stream Error", e);
            throw e;
        }
    }

    async createEmbeddings(options: any): Promise<any> {
        throw new Error("Embeddings not implemented in CIMultiAdapter");
    }

    async summarize(options: any): Promise<any> {
        throw new Error("Summarize not implemented in CIMultiAdapter");
    }

    async completion(options: any): Promise<any> {
        throw new Error("Completion not implemented in CIMultiAdapter");
    }
}
