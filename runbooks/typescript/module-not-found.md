---
category: "typescript_error"
priority: "high"
success_count: 0
last_updated: "2025-12-13"
fingerprint: "ts_module_not_found"
tags: ["module", "import", "dependencies", "typescript"]
---

# Fix: Module Not Found Error

## Diagnosis

This error occurs when TypeScript cannot resolve a module import. Common causes:
- Missing dependency in `package.json`
- Incorrect import path
- Missing `tsconfig.json` path mapping
- Package not installed in `node_modules`

**Error patterns:**
```
Cannot find module 'X' or its corresponding type declarations
Module not found: Error: Can't resolve 'X'
TS2307: Cannot find module 'X'
```

## Solution

### 1. Check if dependency exists in package.json

```bash
cat package.json | grep "module-name"
```

### 2. Install missing dependency

```bash
npm install <package-name>
# or for dev dependencies
npm install --save-dev <package-name>
```

### 3. Verify tsconfig.json paths

If using path aliases, ensure `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### 4. Clear cache and reinstall

```bash
rm -rf node_modules package-lock.json
npm install
```

## Code Template

**package.json addition:**
```json
{
  "dependencies": {
    "missing-package": "^1.0.0"
  }
}
```

**Import fix:**
```typescript
// Before (incorrect)
import { Something } from 'wrong-path';

// After (correct)
import { Something } from 'correct-package-name';
```

## Success Rate

Applied 0 times. Initial template.

## Related Issues

- Dependency version conflicts
- TypeScript version mismatches
- Monorepo path resolution
