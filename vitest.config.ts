import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Test environment
        environment: 'node',

        // Global setup/teardown
        globals: true,

        // Coverage configuration
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'json'],

            // Coverage thresholds - tests will fail if below these
            thresholds: {
                lines: 85,
                functions: 80,
                branches: 80,
                statements: 85
            },

            // Exclude patterns
            exclude: [
                '__tests__/**',
                '**/*.test.ts',
                '**/*.test.js',
                '**/mocks/**',
                '**/helpers/**',
                'node_modules/**',
                'dist/**',
                'coverage/**',
                '**/*.config.*',
                '**/types.ts',
                'server.ts', // Express server
                'vite.config.ts',
                'prisma/**',
                'check-env.ts',
                'fix-env.ts',
                'debug-db.ts',
                'inspect_*.ts',
                'test-*.ts',
                'temp-spell-check-*.ts',
                'constants.ts',
                'services/analysis/BrowserServices.ts', // Frontend services not tested in vitest
                'agent/gym/**', // Legacy or unused gym environment
                'services/telemetry/PathCorrectionService.ts' // Not yet fully integrated/tested
            ],

            // Include patterns (optional - defaults to all files)
            include: [
                'agent/**/*.ts',
                'services/**/*.ts',
                'db/**/*.ts',
                '*.ts'
            ]
        },

        // Test timeout
        testTimeout: 30000, // 30 seconds for integration tests

        // Hook timeout
        hookTimeout: 30000,

        // Reporters
        reporters: ['verbose'],

        // Retry failed tests
        retry: 0, // Don't retry by default

        // Isolation
        isolate: true,

        // Watch mode
        watch: false,

        // Include/exclude patterns
        include: ['__tests__/**/*.test.ts'],
        exclude: ['node_modules/**', 'dist/**'],

        // Setup files
        setupFiles: ['./vitest.setup.ts']
    }
});
