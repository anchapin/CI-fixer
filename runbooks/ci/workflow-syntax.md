---
category: "ci_configuration"
priority: "medium"
success_count: 0
last_updated: "2025-12-13"
fingerprint: "gh_workflow_syntax"
tags: ["github-actions", "yaml", "workflow", "syntax"]
---

# Fix: GitHub Actions Workflow Syntax Error

## Diagnosis

This error occurs when the workflow YAML file has syntax errors or invalid configuration.

**Error patterns:**
```
Invalid workflow file
You have an error in your yaml syntax
unexpected token
mapping values are not allowed in this context
```

**Common causes:**
- Incorrect indentation (YAML requires 2 spaces)
- Missing quotes around special characters
- Invalid step names or references
- Incorrect `uses` action version format

## Solution

### 1. Validate YAML syntax

Use online validator or VS Code YAML extension:
```bash
# Install yamllint
pip install yamllint

# Validate workflow
yamllint .github/workflows/ci.yml
```

### 2. Common syntax fixes

**Indentation (use 2 spaces):**
```yaml
# Wrong
jobs:
    build:
        runs-on: ubuntu-latest

# Correct
jobs:
  build:
    runs-on: ubuntu-latest
```

**Quote special characters:**
```yaml
# Wrong
name: Build & Test

# Correct
name: "Build & Test"
```

**Action versions:**
```yaml
# Wrong
uses: actions/checkout@v4.0

# Correct
uses: actions/checkout@v4
```

### 3. Use GitHub Actions schema validation

Add to VS Code settings:
```json
{
  "yaml.schemas": {
    "https://json.schemastore.org/github-workflow.json": ".github/workflows/*.yml"
  }
}
```

## Code Template

**Valid workflow structure:**
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Dependencies
        run: npm ci
      
      - name: Run Tests
        run: npm test
```

## Success Rate

Applied 0 times. Initial template.

## Prevention

- Use VS Code with YAML extension
- Enable GitHub Actions schema validation
- Test workflows in a branch before merging
- Use `act` to test workflows locally
