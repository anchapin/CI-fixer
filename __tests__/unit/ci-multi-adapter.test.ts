import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CIMultiAdapter } from '../../services/CIMultiAdapter.js';
import { AppConfig } from '../../types.js';

// Mock the LLMService
vi.mock('../../services/llm/LLMService', () => ({
    unifiedGenerate: vi.fn()
}));

import { unifiedGenerate } from '../../services/llm/LLMService.js';

describe('CIMultiAdapter', () => {
    let adapter: CIMultiAdapter;
    let mockConfig: AppConfig;

    beforeEach(() => {
        mockConfig = {
            geminiApiKey: 'test-key',
            githubToken: 'test-token',
            e2bApiKey: 'e2b_test_key',
            tavilyApiKey: 'test-tavily',
            repoUrl: 'https://github.com/test/repo',
            prUrl: 'https://github.com/test/repo/pull/1',
            devEnv: 'e2b'
        };

        adapter = new CIMultiAdapter(mockConfig);
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct name and models', () => {
            expect(adapter.name).toBe('ci-multi-adapter');
            expect(adapter.models).toContain('gemini-2.5-flash');
            expect(adapter.models).toContain('gemini-3-pro-preview');
            expect(adapter.models).toContain('gpt-4o');
        });
    });

    describe('chatStream', () => {
        it('should yield start, content, and end chunks for text response', async () => {
            const mockResult = {
                text: 'Test response',
                toolCalls: undefined
            };

            (unifiedGenerate as any).mockResolvedValue(mockResult);

            const options = {
                model: 'gemini-3-pro-preview',
                messages: [
                    { role: 'user', content: 'Hello' }
                ]
            };

            const chunks: any[] = [];
            for await (const chunk of adapter.chatStream(options)) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(3);
            expect(chunks[0].type).toBe('start');
            expect(chunks[1].type).toBe('content');
            expect(chunks[1].delta).toBe('Test response');
            expect(chunks[2].type).toBe('end');
        });

        it('should yield tool call chunks when tools are returned', async () => {
            const mockResult = {
                text: 'Using tools',
                toolCalls: [
                    {
                        id: 'call-123',
                        function: {
                            name: 'searchWeb',
                            arguments: '{"query":"test"}'
                        }
                    }
                ]
            };

            (unifiedGenerate as any).mockResolvedValue(mockResult);

            const options = {
                model: 'gemini-3-pro-preview',
                messages: [{ role: 'user', content: 'Search for test' }]
            };

            const chunks: any[] = [];
            for await (const chunk of adapter.chatStream(options)) {
                chunks.push(chunk);
            }

            const toolCallChunk = chunks.find(c => c.type === 'tool-call');
            expect(toolCallChunk).toBeDefined();
            expect(toolCallChunk.toolCall.function.name).toBe('searchWeb');
        });

        it('should handle tool calls with varied provider formats', async () => {
            const mockResult = {
                text: '',
                toolCalls: [
                    {
                        name: 'toolName',
                        args: { param: 'value' }
                    }
                ]
            };

            (unifiedGenerate as any).mockResolvedValue(mockResult);

            const options = {
                model: 'gemini-3-pro-preview',
                messages: [{ role: 'user', content: 'Test' }]
            };

            const chunks: any[] = [];
            for await (const chunk of adapter.chatStream(options)) {
                chunks.push(chunk);
            }

            const toolCallChunk = chunks.find(c => c.type === 'tool-call');
            expect(toolCallChunk).toBeDefined();
            expect(toolCallChunk.toolCall.function.name).toBe('toolName');
            expect(toolCallChunk.toolCall.function.arguments).toContain('param');
        });

        it('should handle errors and rethrow', async () => {
            const error = new Error('LLM generation failed');
            (unifiedGenerate as any).mockRejectedValue(error);

            const options = {
                model: 'gemini-3-pro-preview',
                messages: [{ role: 'user', content: 'Test' }]
            };

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await expect(async () => {
                for await (const chunk of adapter.chatStream(options)) {
                    // Should throw before yielding
                }
            }).rejects.toThrow('LLM generation failed');

            expect(consoleSpy).toHaveBeenCalledWith('Adapter Stream Error', error);
            consoleSpy.mockRestore();
        });

        it('should use default model when not specified', async () => {
            const mockResult = { text: 'Response' };
            (unifiedGenerate as any).mockResolvedValue(mockResult);

            const options = {
                messages: [{ role: 'user', content: 'Test' }]
            };

            const chunks: any[] = [];
            for await (const chunk of adapter.chatStream(options)) {
                chunks.push(chunk);
            }

            expect(chunks[0].model).toBe('gemini-3-pro-preview');
        });
    });

    describe('unimplemented methods', () => {
        it('should throw error for createEmbeddings', async () => {
            await expect(adapter.createEmbeddings({})).rejects.toThrow(
                'Embeddings not implemented in CIMultiAdapter'
            );
        });

        it('should throw error for summarize', async () => {
            await expect(adapter.summarize({})).rejects.toThrow(
                'Summarize not implemented in CIMultiAdapter'
            );
        });

        it('should throw error for completion', async () => {
            await expect(adapter.completion({})).rejects.toThrow(
                'Completion not implemented in CIMultiAdapter'
            );
        });
    });
});
