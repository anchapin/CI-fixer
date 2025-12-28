import { GroundingCoordinator } from '../services/grounding/coordinator';
import { GroundingAction } from '../services/grounding/types';
import path from 'path';

async function main() {
  const rootDir = path.resolve('__tests__/fixtures/grounding/project');
  const coordinator = new GroundingCoordinator(rootDir);

  console.log('--- Grounding Verification ---');

  // Case 1: Existing file
  console.log('\nCase 1: Check existing file (src/utils/logger.ts)');
  const res1 = await coordinator.ground({ path: 'src/utils/logger.ts', action: GroundingAction.READ });
  console.log('Result:', res1.success ? 'SUCCESS' : 'FAIL', res1.groundedPath);

  // Case 2: Missing file (Auto-correct)
  console.log('\nCase 2: Check missing file (backend/v1/api.py -> backend/api.py)');
  const res2 = await coordinator.ground({ path: 'backend/v1/api.py', action: GroundingAction.READ });
  console.log('Result:', res2.success ? 'SUCCESS' : 'FAIL', res2.groundedPath);
  
  // Case 3: Missing file (No match)
  console.log('\nCase 3: Check missing file (ghost.ts)');
  const res3 = await coordinator.ground({ path: 'ghost.ts', action: GroundingAction.READ });
  console.log('Result:', res3.success ? 'SUCCESS' : 'FAIL', res3.error);
}

main().catch(console.error);
