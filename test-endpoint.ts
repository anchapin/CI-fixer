
// import { fetch } from 'undici'; // Removed


async function main() {
    const payload = {
        config: {
            repoUrl: 'https://github.com/example/repo',
            githubToken: 'dummy',
            llmProvider: 'google',
            llmModel: 'gemini-1.5-flash',
            devEnv: 'simulation',
            checkEnv: 'simulation',
            selectedRuns: []
        },
        group: {
            id: 'GROUP-TEST-123',
            name: 'TestGroup',
            runIds: ['run-1'],
            mainRun: {}
        },
        initialRepoContext: 'Context'
    };

    try {
        console.log('Sending request to localhost:3001...');
        const res = await fetch('http://localhost:3001/api/agent/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log('Status:', res.status);
        const data = await res.json();
        console.log('Body:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Fetch failed:', e);
    }
}

main();
