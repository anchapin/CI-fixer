import { db } from '../db/client.js';

export interface ErrorNotes {
    decisions: Array<{ decision: string; reasoning: string; timestamp: string }>;
    attempts: Array<{ approach: string; outcome: string; timestamp: string }>;
    blockers: Array<{ blocker: string; impact: string; timestamp: string }>;
    keyFindings: string[];
}

/**
 * Parses notes JSON from database.
 */
function parseNotes(notesJson: string | null): ErrorNotes {
    if (!notesJson) {
        return {
            decisions: [],
            attempts: [],
            blockers: [],
            keyFindings: []
        };
    }

    try {
        return JSON.parse(notesJson);
    } catch (e) {
        console.warn('[NotesManager] Failed to parse notes JSON:', e);
        return {
            decisions: [],
            attempts: [],
            blockers: [],
            keyFindings: []
        };
    }
}

/**
 * Appends a structured note to an error fact.
 */
export async function appendNote(
    errorId: string,
    noteType: keyof ErrorNotes,
    content: any
): Promise<void> {
    const error = await db.errorFact.findUnique({
        where: { id: errorId }
    });

    if (!error) {
        console.warn('[NotesManager] Error not found:', errorId);
        return;
    }

    const notes = parseNotes(error.notes);

    if (noteType === 'keyFindings' && typeof content === 'string') {
        notes.keyFindings.push(content);
    } else if (Array.isArray(notes[noteType])) {
        (notes[noteType] as any[]).push(content);
    }

    await db.errorFact.update({
        where: { id: errorId },
        data: {
            notes: JSON.stringify(notes),
            updatedAt: new Date()
        }
    });
}

/**
 * Records a key decision made by the agent.
 */
export async function recordDecision(
    errorId: string,
    decision: string,
    reasoning: string
): Promise<void> {
    await appendNote(errorId, 'decisions', {
        decision,
        reasoning,
        timestamp: new Date().toISOString()
    });
}

/**
 * Records a fix attempt and its outcome.
 */
export async function recordAttempt(
    errorId: string,
    approach: string,
    outcome: string
): Promise<void> {
    await appendNote(errorId, 'attempts', {
        approach,
        outcome,
        timestamp: new Date().toISOString()
    });
}

/**
 * Records what's blocking progress on this error.
 */
export async function recordBlocker(
    errorId: string,
    blocker: string,
    impact: string
): Promise<void> {
    await appendNote(errorId, 'blockers', {
        blocker,
        impact,
        timestamp: new Date().toISOString()
    });
}

/**
 * Records a key finding discovered during diagnosis or fixing.
 */
export async function recordKeyFinding(
    errorId: string,
    finding: string
): Promise<void> {
    await appendNote(errorId, 'keyFindings', finding);
}

/**
 * Formats notes for inclusion in LLM prompts.
 * Returns a human-readable summary of decisions, attempts, and blockers.
 */
export async function formatNotesForPrompt(errorId: string): Promise<string> {
    const error = await db.errorFact.findUnique({
        where: { id: errorId }
    });

    if (!error || !error.notes) {
        return '';
    }

    const notes = parseNotes(error.notes);
    let output = '## Previous Context & Decisions\n\n';

    if (notes.decisions.length > 0) {
        output += '### Key Decisions:\n';
        notes.decisions.forEach((d, idx) => {
            output += `${idx + 1}. **${d.decision}**\n`;
            output += `   Reasoning: ${d.reasoning}\n`;
            output += `   Time: ${new Date(d.timestamp).toLocaleString()}\n\n`;
        });
    }

    if (notes.attempts.length > 0) {
        output += '### Previous Attempts:\n';
        notes.attempts.forEach((a, idx) => {
            output += `${idx + 1}. Approach: ${a.approach}\n`;
            output += `   Outcome: ${a.outcome}\n`;
            output += `   Time: ${new Date(a.timestamp).toLocaleString()}\n\n`;
        });
    }

    if (notes.blockers.length > 0) {
        output += '### Current Blockers:\n';
        notes.blockers.forEach((b, idx) => {
            output += `${idx + 1}. ${b.blocker}\n`;
            output += `   Impact: ${b.impact}\n`;
            output += `   Time: ${new Date(b.timestamp).toLocaleString()}\n\n`;
        });
    }

    if (notes.keyFindings.length > 0) {
        output += '### Key Findings:\n';
        notes.keyFindings.forEach((f, idx) => {
            output += `- ${f}\n`;
        });
        output += '\n';
    }

    return output;
}

/**
 * Gets the current notes for an error.
 */
export async function getNotes(errorId: string): Promise<ErrorNotes | null> {
    const error = await db.errorFact.findUnique({
        where: { id: errorId }
    });

    if (!error) {
        return null;
    }

    return parseNotes(error.notes);
}

/**
 * Updates the entire notes object for an error.
 * Use this sparingly; prefer the specific record* functions.
 */
export async function updateNotes(errorId: string, notes: ErrorNotes): Promise<void> {
    await db.errorFact.update({
        where: { id: errorId },
        data: {
            notes: JSON.stringify(notes),
            updatedAt: new Date()
        }
    });
}
