# CI-Fixer Workflows

This directory contains executable workflow documentation for manual intervention scenarios where automated fixes require user action.

## Structure

```
workflows/
├── manual-docker-setup.md
├── github-permissions-fix.md
├── environment-variables.md
└── local-verification.md
```

## Workflow Format

Each workflow uses YAML frontmatter for metadata:

```yaml
---
title: "Workflow Title"
category: "infrastructure" | "configuration" | "permissions"
requires_user: true
estimated_time: "X minutes"
---

# Workflow Title

Description of when this workflow is needed.

## Prerequisites
- Requirement 1
- Requirement 2

## Steps

### 1. Step Title
```bash
# Commands to run
```

Expected output: ...

### 2. Next Step
...

## Troubleshooting
- **Error**: Solution
```

## Usage

Workflows are suggested by the agent when:
1. Automated fix fails due to environment constraints
2. Manual configuration is required (API keys, permissions)
3. Infrastructure setup is needed (Docker, databases)

The agent will log:
```
Manual intervention required. See workflow: workflows/manual-docker-setup.md
```

## Creating New Workflows

1. Identify recurring manual intervention scenarios
2. Document step-by-step instructions with commands
3. Include troubleshooting for common issues
4. Test the workflow on a clean environment
5. Update `estimated_time` based on actual completion time
