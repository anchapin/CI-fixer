---
category: docker
priority: high
success_count: 0
last_updated: "2025-01-01"
fingerprint: docker-syntax-errors
tags: ["docker", "syntax", "errors", "runbook"]
---

# Dockerfile Syntax Errors Runbook

This runbook documents common syntax errors introduced when programmatically repairing Dockerfiles and how to avoid them.

## 1. Inline Comments in Multi-line RUN Commands

### The Problem
Docker's parser does not support inline comments (starting with `#`) inside a multi-line `RUN` instruction when lines are joined with backslashes (`\`).

**Incorrect:**
```dockerfile
RUN apt-get update && \
    apt-get install -y \
    # Install curl for healthchecks
    curl \
    vim
```

**Result:** `unknown instruction: #` or similar shell parsing error.

### The Fix
Place comments *before* the `RUN` instruction or use multiple `RUN` instructions if comments are necessary between steps.

**Correct:**
```dockerfile
# Install curl for healthchecks
RUN apt-get update && \
    apt-get install -y \
    curl \
    vim
```

## 2. Typos in apt-get Flags

### The Problem
Agents often hallucinate or mistype flags for `apt-get`. A common error is misspelling `--no-install-recommends`.

**Incorrect:**
- `--no-installfrrecommends`
- `--no-install-recommend`
- `--no-installrecommends`

### The Fix
Always use the exact flag: `--no-install-recommends`.

**Correct:**
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    package-name
```

## 3. Shell Joiner Errors

### The Problem
Forgetting the joiner `&&` or the line continuation `\` in multi-line commands.

**Incorrect:**
```dockerfile
RUN apt-get update
    apt-get install -y curl
```

### The Fix
Ensure every line except the last one ends with ` && \` or just ` \` depending on the command structure.

**Correct:**
```dockerfile
RUN apt-get update && \
    apt-get install -y curl
```
