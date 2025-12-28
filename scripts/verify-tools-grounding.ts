
import { readFile, runCmd } from '../services/sandbox/agent_tools.ts';
import * as path from 'path';

async function main() {
    console.log('--- Phase 2: Tool Integration Verification ---');
    
    // We need to set the CWD to the fixture for this verification to work deterministically
    // or we assume we are in project root and use a known file.
    // Let's use the fixture.
    const fixtureRoot = path.resolve('__tests__/fixtures/grounding/project');
    process.chdir(fixtureRoot);
    console.log(`Changed CWD to: ${fixtureRoot}`);

    console.log('\n[Test 1] readFile with hallucinated path (backend/v1/api.py)');
    const content = await readFile('backend/v1/api.py');
    if (content.trim() === 'api') {
        console.log('SUCCESS: readFile auto-corrected path and read content.');
    } else {
        console.log('FAILURE: readFile returned unexpected content:', content);
    }

    console.log('\n[Test 2] runCmd with hallucinated path (cat backend/v1/api.py)');
    // Use 'type' on Windows, 'cat' on Linux/Mac
    const cmd = process.platform === 'win32' ? 'type backend/v1/api.py' : 'cat backend/v1/api.py';
    const output = await runCmd(cmd);
    if (output.trim() === 'api') {
        console.log('SUCCESS: runCmd auto-corrected path in command.');
    } else {
        console.log('FAILURE: runCmd returned unexpected output:', output);
    }
}

main();
