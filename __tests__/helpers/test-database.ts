import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';

/**
 * Test Database Manager
 * Creates isolated SQLite databases for each test suite
 */
export class TestDatabaseManager {
    protected prisma: PrismaClient | null = null;
    protected dbPath: string | null = null;

    /**
     * Creates a new test database with a unique name
     * Uses file-based SQLite for better debugging
     */
    async setup(): Promise<PrismaClient> {
        // Generate unique database file for this test suite
        const testId = randomBytes(8).toString('hex');
        this.dbPath = path.join(process.cwd(), `test-${testId}.db`);

        // Use relative path for SQLite URL (works on both Windows and Unix)
        const databaseUrl = `file:./${path.basename(this.dbPath)}`;
        process.env.DATABASE_URL = databaseUrl;

        // Run migrations to create schema FIRST
        try {
            execSync('npx prisma db push --skip-generate --accept-data-loss', {
                env: { ...process.env, DATABASE_URL: databaseUrl },
                stdio: 'inherit',
                cwd: process.cwd()
            });
        } catch (error: any) {
            console.error('Failed to create test database:', error.message);
            throw error;
        }

        // Create Prisma client AFTER schema exists
        this.prisma = new PrismaClient();

        return this.prisma;
    }

    /**
     * Cleans up test database and disconnects
     */
    async teardown(): Promise<void> {
        if (this.prisma) {
            await this.prisma.$disconnect();
            this.prisma = null;
        }

        // Delete test database file
        if (this.dbPath && fs.existsSync(this.dbPath)) {
            try {
                fs.unlinkSync(this.dbPath);
            } catch (error) {
                console.warn('Failed to delete test database:', error);
            }
        }
    }

    /**
     * Gets the current Prisma client instance
     */
    getClient(): PrismaClient {
        if (!this.prisma) {
            throw new Error('Database not initialized. Call setup() first.');
        }
        return this.prisma;
    }

    /**
     * Clears all data from the database (useful for test isolation)
     */
    async clearAllData(): Promise<void> {
        if (!this.prisma) return;

        const tablenames = [
            'FixAttempt',
            'AgentMetrics',
            'ErrorFact',
            'FileModification',
            'ActionTemplate',
            'ErrorSolution',
            'FixPattern',
            'AgentRun'
        ];

        try {
            for (const tablename of tablenames) {
                await this.prisma.$executeRawUnsafe(
                    `DELETE FROM "${tablename}";`
                );
            }
        } catch (error) {
            console.error('Error clearing database:', error);
            throw error;
        }
    }
}

/**
 * In-memory test database (faster for unit tests)
 * Actually uses a temp file that's deleted after tests
 */
export class InMemoryTestDatabase extends TestDatabaseManager {
    async setup(): Promise<PrismaClient> {
        // Use temp file instead of true in-memory for Prisma compatibility
        const testId = randomBytes(8).toString('hex');
        this.dbPath = path.join(process.cwd(), `.test-${testId}.db`);

        const databaseUrl = `file:./${path.basename(this.dbPath)}`;
        process.env.DATABASE_URL = databaseUrl;

        // Run migrations to create schema FIRST
        try {
            execSync('npx prisma db push --skip-generate --accept-data-loss', {
                env: { ...process.env, DATABASE_URL: databaseUrl },
                stdio: 'inherit',
                cwd: process.cwd()
            });
        } catch (error: any) {
            console.error('Failed to create test database:', error.message);
            throw error;
        }

        // Create Prisma client AFTER schema exists
        this.prisma = new PrismaClient();

        return this.prisma;
    }
}

/**
 * Database seeding utilities for tests
 */
export const testDataSeeds = {
    /**
     * Creates a sample agent run
     */
    async createAgentRun(prisma: PrismaClient, data?: Partial<{
        id: string;
        groupId: string;
        status: string;
        state: string;
    }>) {
        return await prisma.agentRun.create({
            data: {
                id: data?.id || 'test-run-1',
                groupId: data?.groupId || 'group-1',
                status: data?.status || 'working',
                state: data?.state || '{}',
            }
        });
    },

    /**
     * Creates sample action templates
     */
    async createActionTemplates(prisma: PrismaClient) {
        const templates = [
            {
                id: 'template-1',
                errorCategory: 'syntax',
                filePattern: '*.ts',
                actionType: 'fix_syntax',
                template: 'Fix syntax error',
                frequency: 10,
                successRate: 0.9
            },
            {
                id: 'template-2',
                errorCategory: 'dependency',
                filePattern: 'package.json',
                actionType: 'install_deps',
                template: 'npm install {{package}}',
                frequency: 15,
                successRate: 0.95
            },
            {
                id: 'template-3',
                errorCategory: 'test_failure',
                filePattern: '*.test.ts',
                actionType: 'fix_assertion',
                template: 'Update test assertion',
                frequency: 20,
                successRate: 0.8
            }
        ];

        return await Promise.all(
            templates.map(t => prisma.actionTemplate.create({ data: t }))
        );
    },

    /**
     * Creates sample fix patterns
     */
    async createFixPatterns(prisma: PrismaClient) {
        const patterns = [
            {
                id: 'pattern-1',
                errorFingerprint: 'hash-1',
                errorCategory: 'syntax',
                filePath: 'app.ts',
                fixTemplate: JSON.stringify({ action: 'edit', edits: ['fix1'] }),
                successCount: 5
            },
            {
                id: 'pattern-2',
                errorFingerprint: 'hash-2',
                errorCategory: 'dependency',
                filePath: 'package.json',
                fixTemplate: JSON.stringify({ action: 'command', command: 'npm install' }),
                successCount: 10
            }
        ];

        return await Promise.all(
            patterns.map(p => prisma.fixPattern.create({ data: p }))
        );
    },

    /**
     * Creates sample error solutions
     */
    async createErrorSolutions(prisma: PrismaClient) {
        const solutions = [
            {
                id: 'solution-1',
                errorFingerprint: 'hash-1',
                solution: 'Fix syntax error by adding semicolon',
                filesAffected: JSON.stringify(['app.ts']),
                commandsUsed: JSON.stringify([]),
                successRate: 0.9,
                timesApplied: 5,
                avgIterations: 2.0
            },
            {
                id: 'solution-2',
                errorFingerprint: 'hash-2',
                solution: 'Install missing dependency',
                filesAffected: JSON.stringify(['package.json']),
                commandsUsed: JSON.stringify(['npm install lodash']),
                successRate: 0.95,
                timesApplied: 10,
                avgIterations: 1.5
            }
        ];

        return await Promise.all(
            solutions.map(s => prisma.errorSolution.create({ data: s }))
        );
    }
};
