
import { LoopDetector } from '../services/LoopDetector';
import { LoopStateSnapshot } from '../types';

async function verifyLoopDetector() {
  console.log('Starting LoopDetector Verification...');

  const detector = new LoopDetector();
  console.log('LoopDetector instantiated.');

  const state1: LoopStateSnapshot = {
    iteration: 1,
    filesChanged: ['src/app.ts'],
    contentChecksum: 'checksum_v1',
    errorFingerprint: 'Error: Syntax error',
    timestamp: Date.now()
  };

  console.log('Adding State 1:', JSON.stringify(state1, null, 2));
  detector.addState(state1);

  const state2: LoopStateSnapshot = {
    iteration: 2,
    filesChanged: ['src/app.ts'],
    contentChecksum: 'checksum_v1', // Same content
    errorFingerprint: 'Error: Syntax error', // Same error
    timestamp: Date.now() + 1000
  };

  console.log('Checking State 2 (Identical to State 1)...');
  const result1 = detector.detectLoop(state2);
  
  if (result1.detected && result1.duplicateOfIteration === 1) {
    console.log('SUCCESS: Loop correctly detected!');
    console.log('Result:', result1);
  } else {
    console.error('FAILURE: Loop NOT detected.', result1);
    process.exit(1);
  }

  const state3: LoopStateSnapshot = {
    iteration: 3,
    filesChanged: ['src/app.ts'],
    contentChecksum: 'checksum_v2', // Different content
    errorFingerprint: 'Error: Syntax error',
    timestamp: Date.now() + 2000
  };

  console.log('Checking State 3 (Different content)...');
  const result2 = detector.detectLoop(state3);

  if (!result2.detected) {
    console.log('SUCCESS: New state correctly accepted.');
  } else {
    console.error('FAILURE: False positive loop detection.', result2);
    process.exit(1);
  }

  console.log('Verification Complete: All checks passed.');
}

verifyLoopDetector().catch(console.error);
