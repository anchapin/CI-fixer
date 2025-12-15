import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupInMemoryDb, getTestDb } from '../helpers/vitest-setup.js';
import {
    recordDecision,
    recordAttempt,
    recordBlocker,
    recordKeyFinding,
    formatNotesForPrompt,
    getNotes
} from '../../services/notes-manager.js';

// Mock database client to use test database
vi.mock('../../db/client.js', async () => {
    const { getTestDb } = await import('../helpers/vitest-setup.js');
    return {
        db: new Proxy({}, {
            get(target, prop) {
                const testDb = getTestDb();
                const value = (testDb as any)[prop];
                if (typeof value === 'function') {
                    return value.bind(testDb);
                }
                return value;
            }
        })
    };
});

// Setup test database
setupInMemoryDb();

describe('NotesManager', () => {
    let testRunId: string;
    let errorFactId: string;

    beforeEach(async () => {
        const db = getTestDb();

        // Create test agent run
        const agentRun = await db.agentRun.create({
            data: {
                groupId: 'test-group',
                status: 'working',
                state: '{}'
            }
        });
        testRunId = agentRun.id;

        // Create test error fact
        const errorFact = await db.errorFact.create({
            data: {
                summary: 'Test error',
                filePath: 'test.ts',
                fixAction: 'edit',
                runId: testRunId,
                status: 'open',
                notes: JSON.stringify({
                    decisions: [],
                    attempts: [],
                    blockers: [],
                    keyFindings: []
                })
            }
        });
        errorFactId = errorFact.id;
    });

    afterEach(async () => {
        const db = getTestDb();
        await db.errorFact.deleteMany({});
        await db.agentRun.deleteMany({});
    });

    describe('recordDecision', () => {
        it('should record a decision', async () => {
            await recordDecision(errorFactId, 'Use approach A', 'It has better performance');

            const notes = await getNotes(errorFactId);

            expect(notes?.decisions).toHaveLength(1);
            expect(notes?.decisions[0].decision).toBe('Use approach A');
            expect(notes?.decisions[0].reasoning).toBe('It has better performance');
        });

        it('should append multiple decisions', async () => {
            await recordDecision(errorFactId, 'Decision 1', 'Reason 1');
            await recordDecision(errorFactId, 'Decision 2', 'Reason 2');

            const notes = await getNotes(errorFactId);

            expect(notes?.decisions).toHaveLength(2);
        });
    });

    describe('recordAttempt', () => {
        it('should record an attempt', async () => {
            await recordAttempt(errorFactId, 'Try fixing with regex', 'Failed due to edge case');

            const notes = await getNotes(errorFactId);

            expect(notes?.attempts).toHaveLength(1);
            expect(notes?.attempts[0].approach).toBe('Try fixing with regex');
            expect(notes?.attempts[0].outcome).toBe('Failed due to edge case');
        });
    });

    describe('recordBlocker', () => {
        it('should record a blocker', async () => {
            await recordBlocker(errorFactId, 'Missing dependency', 'Cannot proceed without it');

            const notes = await getNotes(errorFactId);

            expect(notes?.blockers).toHaveLength(1);
            expect(notes?.blockers[0].blocker).toBe('Missing dependency');
            expect(notes?.blockers[0].impact).toBe('Cannot proceed without it');
        });
    });

    describe('recordKeyFinding', () => {
        it('should record a key finding', async () => {
            await recordKeyFinding(errorFactId, 'Root cause is in module X');

            const notes = await getNotes(errorFactId);

            expect(notes?.keyFindings).toHaveLength(1);
            expect(notes?.keyFindings[0]).toBe('Root cause is in module X');
        });

        it('should append multiple findings', async () => {
            await recordKeyFinding(errorFactId, 'Finding 1');
            await recordKeyFinding(errorFactId, 'Finding 2');

            const notes = await getNotes(errorFactId);

            expect(notes?.keyFindings).toHaveLength(2);
        });
    });

    describe('formatNotesForPrompt', () => {
        it('should format notes for LLM context', async () => {
            await recordDecision(errorFactId, 'Use approach A', 'Better performance');
            await recordAttempt(errorFactId, 'Try regex', 'Failed');
            await recordBlocker(errorFactId, 'Missing dep', 'Blocking progress');
            await recordKeyFinding(errorFactId, 'Root cause identified');

            const formatted = await formatNotesForPrompt(errorFactId);

            expect(formatted).toContain('Key Decisions:');
            expect(formatted).toContain('Use approach A');
            expect(formatted).toContain('Previous Attempts:');
            expect(formatted).toContain('Try regex');
            expect(formatted).toContain('Current Blockers:');
            expect(formatted).toContain('Missing dep');
            expect(formatted).toContain('Key Findings:');
            expect(formatted).toContain('Root cause identified');
        });

        it('should return empty string for error with no notes', async () => {
            const db = getTestDb();

            // Create error without notes
            const errorFact = await db.errorFact.create({
                data: {
                    summary: 'Test error 2',
                    filePath: 'test2.ts',
                    fixAction: 'edit',
                    runId: testRunId,
                    status: 'open'
                }
            });

            const formatted = await formatNotesForPrompt(errorFact.id);

            expect(formatted).toBe('');
        });
    });

    describe('getNotes', () => {
        it('should return notes for an error', async () => {
            await recordDecision(errorFactId, 'Test decision', 'Test reasoning');

            const notes = await getNotes(errorFactId);

            expect(notes).toBeDefined();
            expect(notes?.decisions).toHaveLength(1);
        });

        it('should return null for non-existent error', async () => {
            const notes = await getNotes('non-existent-id');

            expect(notes).toBeNull();
        });
    });
});
