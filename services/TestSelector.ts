import * as path from 'path';

export class TestSelector {
    selectTestCommand(files: string[]): string {
        const hasPython = files.some(f => f.endsWith('.py') || f.endsWith('requirements.txt'));
        const hasPackageJson = files.includes('package.json') || files.includes('pnpm-lock.yaml');
        
        // Frontend detection: .ts, .tsx, .js in src/ or generally, excluding server/ backend/
        const hasFrontend = files.some(f => {
            if (f.endsWith('.py') || f.endsWith('requirements.txt') || f === 'package.json') return false;
            if (f.startsWith('server/') || f.startsWith('backend/')) return false;
            return f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx');
        });

        // Backend TS detection: .ts in server/ or backend/
        const hasBackendTS = files.some(f => {
            if (!f.endsWith('.ts')) return false;
            return f.startsWith('server/') || f.startsWith('backend/');
        });

        // Priority 1: Full Suite triggers
        if (hasPackageJson) {
            return 'npm test';
        }

        // Priority 2: Mixed Python + Frontend/Backend TS
        if (hasPython && (hasFrontend || hasBackendTS)) {
            return 'npm test && pytest';
        }

        // Priority 3: Single Language/Scope
        if (hasPython) {
            return 'pytest';
        }

        if (hasBackendTS) {
            return 'npm run test:backend';
        }

        if (hasFrontend) {
            return 'npm run test:frontend';
        }

        // Default Fallback
        return 'npm test';
    }
}