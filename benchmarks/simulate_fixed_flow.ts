
import { CIFixerEnv, GymAction } from '../agent/gym/environment.js';
import { GymRecorder } from '../agent/gym/recorder.js';
import { SimulationSandbox } from '../sandbox.js';
import path from 'path';
import fs from 'fs';

/**
 * Simulation of a Fixed Flow
 * 
 * This script demonstrates a successful agent fix trajectory,
 * exercising the Gym environment and recording metrics.
 */
async function simulateFixedFlow() {
    console.log("Starting Fixed Flow Simulation...");

    const recorder = new GymRecorder('sim-fixed-01', 'https://github.com/mock/repo');
    const env = new CIFixerEnv(async () => {
        const sb = new SimulationSandbox();
        await sb.init();
        return sb;
    }, recorder);

    const obs = await env.reset();
    console.log("Environment Reset.");

    // Step 1: Analyze
    console.log("Step 1: Analyzing Logs...");
    await env.step({ type: 'run_command', command: 'cat error.log' });

    // Step 2: Search
    console.log("Step 2: Searching Code...");
    await env.step({ type: 'run_command', command: 'grep -r "TypeError" .' });

    // Step 3: Fix
    console.log("Step 3: Writing Fix...");
    await env.step({ 
        type: 'write_file', 
        path: 'src/utils.ts', 
        content: 'export const fix = () => 10;' 
    });

    // Step 4: Verify
    console.log("Step 4: Running Tests...");
    await env.step({ type: 'run_command', command: 'npm test' });

    // Step 5: Submit
    console.log("Step 5: Submitting Fix...");
    const finalResult = await env.step({ type: 'submit_fix' });

    console.log("Simulation Complete.");
    console.log(`Final Reward: ${finalResult.reward}`);
    
    recorder.finalize(true);
    await env.close();
    
    // Ensure trajectory was saved
    const trajDir = path.resolve(process.cwd(), 'logs/gym');
    const files = fs.readdirSync(trajDir);
    const latestTraj = files.filter(f => f.includes('sim-fixed-01')).sort().pop();
    
    if (latestTraj) {
        console.log(`Trajectory saved to: ${path.join('logs/gym', latestTraj)}`);
    } else {
        console.warn("Warning: Trajectory file not found!");
    }
}

simulateFixedFlow().catch(console.error);
