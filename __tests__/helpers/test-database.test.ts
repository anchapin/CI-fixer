import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabaseManager, testDataSeeds } from '../helpers/test-database.js';

describe('Test Database Helpers', () => {
    describe('TestDatabaseManager', () => {
        const dbManager = new TestDatabaseManager();
        let prisma: any;

        it('should create and setup database', async () => {
            prisma = await dbManager.setup();

            expect(prisma).toBeDefined();
            expect(dbManager.getClient()).toBe(prisma);
        });

        it('should throw when getClient called before setup', () => {
            const newManager = new TestDatabaseManager();

            expect(() => newManager.getClient()).toThrow('Database not initialized');
        });

        it('should clear all data from tables', async () => {
            if (!prisma) {
                prisma = await dbManager.setup();
            }

            // Create some test data
            await prisma.agentRun.create({
                data: {
                    id: 'test-run',
                    groupId: 'test-group',
                    status: 'working',
                    state: '{}'
                }
            });

            // Clear data
            await dbManager.clearAllData();

            // Verify data is cleared
            const runs = await prisma.agentRun.findMany();
            expect(runs).toHaveLength(0);
        });

        it('should teardown and cleanup database', async () => {
            if (!prisma) {
                prisma = await dbManager.setup();
            }

            await dbManager.teardown();

            // After teardown, getClient should throw
            expect(() => dbManager.getClient()).toThrow();
        });
    });

    describe('testDataSeeds', () => {
        const dbManager = new TestDatabaseManager();
        let prisma: any;

        beforeEach(async () => {
            prisma = await dbManager.setup();
        });

        afterEach(async () => {
            await dbManager.teardown();
        });

        describe('createAgentRun', () => {
            it('should create agent run with default data', async () => {
                const run = await testDataSeeds.createAgentRun(prisma);

                expect(run.id).toBe('test-run-1');
                expect(run.groupId).toBe('group-1');
                expect(run.status).toBe('working');
            });

            it('should create agent run with custom data', async () => {
                const run = await testDataSeeds.createAgentRun(prisma, {
                    id: 'custom-run',
                    groupId: 'custom-group',
                    status: 'completed',
                    state: '{"step": 1}'
                });

                expect(run.id).toBe('custom-run');
                expect(run.groupId).toBe('custom-group');
                expect(run.status).toBe('completed');
                expect(run.state).toBe('{"step": 1}');
            });
        });

        describe('createActionTemplates', () => {
            it('should create all action templates', async () => {
                const templates = await testDataSeeds.createActionTemplates(prisma);

                expect(templates).toHaveLength(3);

                const categories = templates.map(t => t.errorCategory);
                expect(categories).toContain('syntax');
                expect(categories).toContain('dependency');
                expect(categories).toContain('test_failure');
            });

            it('should create templates with correct properties', async () => {
                const templates = await testDataSeeds.createActionTemplates(prisma);

                const syntaxTemplate = templates.find(t => t.errorCategory === 'syntax');
                expect(syntaxTemplate).toBeDefined();
                expect(syntaxTemplate!.actionType).toBe('fix_syntax');
                expect(syntaxTemplate!.frequency).toBe(10);
                expect(syntaxTemplate!.successRate).toBe(0.9);
            });
        });

        describe('createFixPatterns', () => {
            it('should create fix patterns', async () => {
                const patterns = await testDataSeeds.createFixPatterns(prisma);

                expect(patterns).toHaveLength(2);
            });

            it('should create patterns with correct structure', async () => {
                const patterns = await testDataSeeds.createFixPatterns(prisma);

                const syntaxPattern = patterns.find(p => p.errorCategory === 'syntax');
                expect(syntaxPattern).toBeDefined();
                expect(syntaxPattern!.errorFingerprint).toBe('hash-1');
                expect(syntaxPattern!.filePath).toBe('app.ts');
                expect(syntaxPattern!.successCount).toBe(5);

                const template = JSON.parse(syntaxPattern!.fixTemplate);
                expect(template.action).toBe('edit');
            });

            it('should create command-based pattern', async () => {
                const patterns = await testDataSeeds.createFixPatterns(prisma);

                const depPattern = patterns.find(p => p.errorCategory === 'dependency');
                const template = JSON.parse(depPattern!.fixTemplate);

                expect(template.action).toBe('command');
                expect(template.command).toBe('npm install');
            });
        });

        describe('createErrorSolutions', () => {
            it('should create error solutions', async () => {
                const solutions = await testDataSeeds.createErrorSolutions(prisma);

                expect(solutions).toHaveLength(2);
            });

            it('should create solutions with correct metrics', async () => {
                const solutions = await testDataSeeds.createErrorSolutions(prisma);

                const solution1 = solutions.find(s => s.errorFingerprint === 'hash-1');
                expect(solution1).toBeDefined();
                expect(solution1!.successRate).toBe(0.9);
                expect(solution1!.timesApplied).toBe(5);
                expect(solution1!.avgIterations).toBe(2.0);

                const filesAffected = JSON.parse(solution1!.filesAffected);
                expect(filesAffected).toContain('app.ts');
            });

            it('should create solution with commands', async () => {
                const solutions = await testDataSeeds.createErrorSolutions(prisma);

                const solution2 = solutions.find(s => s.errorFingerprint === 'hash-2');
                const commands = JSON.parse(solution2!.commandsUsed);

                expect(commands).toContain('npm install lodash');
            });
        });
    });
});
