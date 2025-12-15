/**
 * Feature Flags Configuration
 * Controls gradual rollout of research features
 */

export interface FeatureFlags {
    // Phase 1: Context Compression
    enableContextCompression: boolean;
    compressionRatio: number;

    // Phase 2: Semantic Search
    enableSemanticSearch: boolean;
    semanticSearchWeight: number;

    // Phase 3: Enhanced KB
    enableEnhancedKB: boolean;
    kbSimilarityThreshold: number;

    // Phase 4: Thompson Sampling
    enableThompsonSampling: boolean;
    maxAdaptiveIterations: number;

    // Phase 5: Multi-Agent
    enableMultiAgent: boolean;
    maxParallelAgents: number;

    // Phase 6: Reflection
    enableReflection: boolean;
    learningRetentionDays: number;
}

export const DEFAULT_FLAGS: FeatureFlags = {
    enableContextCompression: false,
    compressionRatio: 6.0,
    enableSemanticSearch: false,
    semanticSearchWeight: 0.7,
    enableEnhancedKB: false,
    kbSimilarityThreshold: 0.6,
    enableThompsonSampling: false,
    maxAdaptiveIterations: 15,
    enableMultiAgent: false,
    maxParallelAgents: 5,
    enableReflection: false,
    learningRetentionDays: 30
};

/**
 * Load feature flags from environment variables
 */
export function loadFeatureFlags(): FeatureFlags {
    return {
        enableContextCompression: process.env.ENABLE_CONTEXT_COMPRESSION === 'true',
        compressionRatio: parseFloat(process.env.COMPRESSION_RATIO || '6.0'),
        enableSemanticSearch: process.env.ENABLE_SEMANTIC_SEARCH === 'true',
        semanticSearchWeight: parseFloat(process.env.SEMANTIC_SEARCH_WEIGHT || '0.7'),
        enableEnhancedKB: process.env.ENABLE_ENHANCED_KB === 'true',
        kbSimilarityThreshold: parseFloat(process.env.KB_SIMILARITY_THRESHOLD || '0.6'),
        enableThompsonSampling: process.env.ENABLE_THOMPSON_SAMPLING === 'true',
        maxAdaptiveIterations: parseInt(process.env.MAX_ADAPTIVE_ITERATIONS || '15'),
        enableMultiAgent: process.env.ENABLE_MULTI_AGENT === 'true',
        maxParallelAgents: parseInt(process.env.MAX_PARALLEL_AGENTS || '5'),
        enableReflection: process.env.ENABLE_REFLECTION === 'true',
        learningRetentionDays: parseInt(process.env.LEARNING_RETENTION_DAYS || '30')
    };
}

/**
 * Get feature flag status summary
 */
export function getFeatureFlagSummary(flags: FeatureFlags): string {
    const enabled = [];
    if (flags.enableContextCompression) enabled.push('Context Compression');
    if (flags.enableSemanticSearch) enabled.push('Semantic Search');
    if (flags.enableEnhancedKB) enabled.push('Enhanced KB');
    if (flags.enableThompsonSampling) enabled.push('Thompson Sampling');
    if (flags.enableMultiAgent) enabled.push('Multi-Agent');
    if (flags.enableReflection) enabled.push('Reflection');

    return enabled.length > 0
        ? `Enabled features: ${enabled.join(', ')}`
        : 'All research features disabled (baseline mode)';
}
