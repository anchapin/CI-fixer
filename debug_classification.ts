
import { classifyError, ErrorCategory } from './errorClassification.js';

function runTest(name: string, logs: string) {
    console.log(`\n--- Test: ${name} ---`);
    const result = classifyError(logs);
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
}

const diskLogs = `
[ERROR] npm ci failed
npm ERR! code ENOSPC
npm ERR! syscall write
npm ERR! errno -28
npm ERR! write ENOSPC: no space left on device, write
`;
const diskResult = runTest('Disk Space', diskLogs);
if (diskResult.category !== ErrorCategory.DISK_SPACE) {
    console.error('FAIL: Expected DISK_SPACE, got', diskResult.category);
} else {
    console.log('PASS');
}


const syntaxLogs = `
SyntaxError: Unexpected token '}'
    at Module._compile (node:internal/modules/cjs/loader:1358:18)
    at Object..js (node:internal/modules/cjs/loader:1416:10)
File: src/components/Button.tsx:45:3
`;
const syntaxResult = runTest('Syntax with File', syntaxLogs);
if (!syntaxResult.affectedFiles.includes('src/components/Button.tsx')) {
    console.error('FAIL: Expected src/components/Button.tsx, got', syntaxResult.affectedFiles);
} else {
    console.log('PASS');
}


const buildLogs = `
error TS2322: Type 'string' is not assignable to type 'number'.
src/utils/math.ts(15,5): error TS2322
BUILD FAILED
`;
const buildResult = runTest('Build Error', buildLogs);
if (!buildResult.affectedFiles.includes('src/utils/math.ts')) {
    console.error('FAIL: Expected src/utils/math.ts, got', buildResult.affectedFiles);
} else {
    console.log('PASS');
}
