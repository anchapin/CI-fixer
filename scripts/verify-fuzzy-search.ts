import { findUniqueFile } from '../utils/fileVerification';
import * as path from 'node:path';

async function run() {
    const rootDir = process.cwd();
    const testFile = 'package.jsn'; // Misspelled package.json
    
    console.log(`Searching for: ${testFile} in ${rootDir}...`);
    const result = await findUniqueFile(testFile, rootDir);
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.found && result.path?.endsWith('package.json')) {
        console.log('✅ SUCCESS: Correctly found package.json fuzzy matching package.jsn');
    } else {
        console.log('❌ FAILURE: Could not find package.json');
        process.exit(1);
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
