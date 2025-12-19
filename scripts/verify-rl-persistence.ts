import { PrismaClient } from '@prisma/client';
import { RewardEngine } from '../services/RewardEngine.js';
import { LearningMetricService } from '../services/LearningMetricService.js';
import { db } from '../db/client.js';

async function verifyPersistence() {
    console.log('--- Starting RL Persistence Verification ---');

    try {
        const rewardEngine = new RewardEngine(db);
        const metricService = new LearningMetricService(db);

        // 1. Create a dummy AgentRun first (RewardSignal needs a runId)
        console.log('Creating dummy AgentRun...');
        const runId = `verify-run-${Date.now()}`;
        await db.agentRun.create({
            data: {
                id: runId,
                groupId: 'verification-group',
                status: 'success',
                state: '{}'
            }
        });

        // 2. Record a Reward Signal
        console.log('Recording dummy RewardSignal...');
        await rewardEngine.recordReward(runId, {
            success: true,
            llmCost: 0.02,
            totalLatency: 3000,
            llmTokensInput: 500,
            llmTokensOutput: 200,
            toolCallCount: 2
        });

        // 3. Record a Learning Metric
        console.log('Recording dummy LearningMetric...');
        await metricService.recordMetric('Fix Rate', 0.88, { note: 'Manual Verification' });

        console.log('--- Verification Data Written Successfully ---');
        console.log(`Run ID used: ${runId}`);
        console.log('Please check Prisma Studio (http://localhost:5555) to confirm.');

    } catch (error) {
        console.error('Verification failed:', error);
    } finally {
        // We don't disconnect here as we are using the proxied db which handles its own lifecycle
        // But if it was a raw PrismaClient we would.
    }
}

verifyPersistence().catch(console.error);
