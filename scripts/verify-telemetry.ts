
import { recordPathCorrection, getRecentPathCorrections } from '../services/telemetry/PathCorrectionService';
import { db } from '../db/client';

async function main() {
    console.log('--- Telemetry Verification ---');

    const testId = `test-run-${Date.now()}`;
    const testEvent = {
        originalPath: 'hallucinated.ts',
        correctedPath: 'real.ts',
        filename: 'real.ts',
        toolName: 'manual_verify',
        agentRunId: testId
    };

    console.log('Recording test correction...');
    await recordPathCorrection(testEvent);

    console.log('Fetching recent corrections...');
    const recent = await getRecentPathCorrections(5);
    
    const found = recent.find(c => c.agentRunId === testId);
    
    if (found) {
        console.log('SUCCESS: Found recorded correction in database.');
        console.log(found);
    } else {
        console.log('FAILURE: Could not find recorded correction.');
    }

    // Cleanup (Optional, but good for local dev DB)
    // await db.pathCorrection.deleteMany({ where: { agentRunId: testId } });
}

main().catch(console.error);
