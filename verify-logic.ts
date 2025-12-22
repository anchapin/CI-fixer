import { findUniqueFile } from './utils/fileVerification';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function runManualVerification() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-verification-'));
    console.log(`Created temp directory: ${tempDir}`);

    try {
        // Setup scenarios
        const srcDir = path.join(tempDir, 'src');
        const libDir = path.join(tempDir, 'lib');
        fs.mkdirSync(srcDir);
        fs.mkdirSync(libDir);

        fs.writeFileSync(path.join(tempDir, 'README.md'), 'root readme');
        fs.writeFileSync(path.join(srcDir, 'app.ts'), 'src app');
        fs.writeFileSync(path.join(srcDir, 'utils.ts'), 'src utils');
        fs.writeFileSync(path.join(libDir, 'utils.ts'), 'lib utils');

        console.log('\n--- Scenario 1: Exact Match ---');
        const res1 = await findUniqueFile('README.md', tempDir);
        console.log('Search: README.md');
        console.log(`Found: ${res1.found}, Path: ${res1.path}`);

        console.log('\n--- Scenario 2: Hallucinated path, unique match elsewhere ---');
        const res2 = await findUniqueFile('app.ts', tempDir);
        console.log('Search: app.ts (exists in src/app.ts)');
        console.log(`Found: ${res2.found}, Path: ${res2.path}`);

        console.log('\n--- Scenario 3: Multiple matches ---');
        const res3 = await findUniqueFile('utils.ts', tempDir);
        console.log('Search: utils.ts (exists in src/ and lib/)');
        console.log(`Found: ${res3.found}, Matches: ${res3.matches.length}`);
        res3.matches.forEach(m => console.log(` - ${m}`));

        console.log('\n--- Scenario 4: No matches ---');
        const res4 = await findUniqueFile('missing.ts', tempDir);
        console.log('Search: missing.ts');
        console.log(`Found: ${res4.found}, Matches: ${res4.matches.length}`);

    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`\nCleaned up temp directory: ${tempDir}`);
    }
}

runManualVerification().catch(console.error);
