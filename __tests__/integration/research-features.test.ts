import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadFeatureFlags } from '../../config/feature-flags.js';

describe('Research Features Integration', () => {
    beforeEach(() => {
        // Reset environment
        delete process.env.ENABLE_CONTEXT_COMPRESSION;
        delete process.env.ENABLE_SEMANTIC_SEARCH;
        delete process.env.ENABLE_ENHANCED_KB;
        delete process.env.ENABLE_THOMPSON_SAMPLING;
        delete process.env.ENABLE_MULTI_AGENT;
        delete process.env.ENABLE_REFLECTION;
    });

    describe('Feature Flags', () => {
        it('should load default flags when env vars not set', () => {
            const flags = loadFeatureFlags();

            expect(flags.enableContextCompression).toBe(false);
            expect(flags.enableSemanticSearch).toBe(false);
            expect(flags.enableEnhancedKB).toBe(false);
            expect(flags.enableThompsonSampling).toBe(false);
            expect(flags.enableMultiAgent).toBe(false);
            expect(flags.enableReflection).toBe(false);
        });

        it('should enable features when env vars set', () => {
            process.env.ENABLE_CONTEXT_COMPRESSION = 'true';
            process.env.ENABLE_SEMANTIC_SEARCH = 'true';

            const flags = loadFeatureFlags();

            expect(flags.enableContextCompression).toBe(true);
            expect(flags.enableSemanticSearch).toBe(true);
        });

        it('should load numeric configuration', () => {
            process.env.COMPRESSION_RATIO = '8.0';
            process.env.MAX_ADAPTIVE_ITERATIONS = '20';

            const flags = loadFeatureFlags();

            expect(flags.compressionRatio).toBe(8.0);
            expect(flags.maxAdaptiveIterations).toBe(20);
        });
    });

    describe('Context Compression Integration', () => {
        it('should compress large logs when enabled', async () => {
            process.env.ENABLE_CONTEXT_COMPRESSION = 'true';

            const { adaptiveCompress } = await import('../../services/context-compression/compressor.js');

            const longText = 'word '.repeat(1000);
            const result = adaptiveCompress(longText, 100);

            expect(result.compressedLength).toBeLessThan(result.originalLength);
            expect(result.compressionRatio).toBeGreaterThan(1.0);
        });
    });

    describe('Semantic Search Integration', () => {
        it('should index and search files when enabled', async () => {
            process.env.ENABLE_SEMANTIC_SEARCH = 'true';

            const { SemanticSearchService } = await import('../../services/semantic-search/search-service.js');
            const service = new SemanticSearchService();

            const files = new Map([
                ['user.ts', 'class User { getName() { return this.name; } }'],
                ['product.ts', 'class Product { getPrice() { return this.price; } }']
            ]);

            await service.indexFiles(files);
            const results = service.search('user management', 2);

            expect(results.length).toBeGreaterThan(0);
        });
    });

    describe('Enhanced KB Integration', () => {
        it('should retrieve fix patterns when enabled', async () => {
            process.env.ENABLE_ENHANCED_KB = 'true';

            const { EnhancedKnowledgeBase } = await import('../../services/knowledge-base/enhanced-kb.js');
            const kb = new EnhancedKnowledgeBase();

            kb.addPattern({
                id: 'p1',
                errorType: 'TypeError',
                errorMessage: 'Cannot read property of undefined',
                context: 'user.ts',
                fixPattern: 'Add null check',
                metadata: {
                    language: 'typescript',
                    frequency: 5,
                    successRate: 0.9,
                    lastUsed: Date.now()
                }
            });

            const results = kb.retrieveFixPatterns(
                'Cannot read property of undefined',
                'TypeError',
                'typescript',
                1
            );

            expect(results.length).toBe(1);
            expect(results[0].score).toBeGreaterThan(0);
        });
    });

    describe('Thompson Sampling Integration', () => {
        it('should make adaptive iteration decisions when enabled', async () => {
            process.env.ENABLE_THOMPSON_SAMPLING = 'true';

            const { ThompsonSamplingRefiner } = await import('../../services/iterative-refinement/thompson-sampling.js');
            const refiner = new ThompsonSamplingRefiner();

            const decision = refiner.decideIteration({
                currentIteration: 3,
                maxIterations: 10,
                successHistory: [true, false, true],
                costSoFar: 500,
                maxCost: 2000
            });

            expect(decision.action).toMatch(/continue|terminate/);
            expect(decision.confidence).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Multi-Agent Integration', () => {
        it('should coordinate parallel execution when enabled', async () => {
            process.env.ENABLE_MULTI_AGENT = 'true';

            const { MultiAgentCoordinator } = await import('../../services/multi-agent/coordinator.js');
            const coordinator = new MultiAgentCoordinator();

            coordinator.addTask({
                id: 't1',
                errorId: 'e1',
                role: 'fixer',
                priority: 1,
                dependencies: [],
                status: 'pending'
            });

            const result = await coordinator.executeTasks();

            expect(result.success).toBe(true);
            expect(result.tasksCompleted).toBe(1);
        });
    });

    describe('Reflection Integration', () => {
        it('should learn from failures when enabled', async () => {
            process.env.ENABLE_REFLECTION = 'true';

            const { ReflectionLearningSystem } = await import('../../services/reflection/learning-system.js');
            const system = new ReflectionLearningSystem();

            system.recordFailure('TypeError', 'Null reference', 'Fix attempt', 'context');
            system.recordFailure('TypeError', 'Null reference', 'Fix attempt 2', 'context');
            system.recordFailure('TypeError', 'Null reference', 'Fix attempt 3', 'context');

            const result = system.reflect();

            expect(result.patternsIdentified).toBeGreaterThan(0);
        });
    });
});
