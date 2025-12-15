
import { db, disconnectDb } from './db/client.js';
import { v4 as uuidv4 } from 'uuid';

async function main() {
    try {
        console.log('Testing DB connection...');
        const agentId = 'GROUP-TEST-123';
        const initialState = {
            groupId: agentId,
            name: 'debug-run',
            phase: 'IDLE',
            iteration: 0,
            status: 'working',
            files: {},
            fileReservations: [],
            activeLog: ''
        };

        console.log('Creating AgentRun...');
        const run = await db.agentRun.create({
            data: {
                id: agentId,
                groupId: agentId,
                status: 'working',
                state: JSON.stringify(initialState)
            }
        });
        console.log('AgentRun created:', run);

        console.log('Deleting AgentRun...');
        await db.agentRun.delete({
            where: { id: agentId }
        });
        console.log('AgentRun deleted.');

    } catch (e: any) {
        console.error('DB Test Failed:', e);
    } finally {
        await disconnectDb();
    }
}

main();
