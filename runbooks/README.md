# CI-Fixer Runbooks

This directory contains curated fix patterns for common CI/CD errors, stored as Markdown files with YAML frontmatter for metadata.

## Structure

```
runbooks/
├── typescript/       # TypeScript-specific errors
├── docker/          # Docker and containerization issues
├── ci/              # GitHub Actions and CI configuration
├── dependencies/    # Package management and dependency errors
└── build/           # Build system errors
```

## Runbook Format

Each runbook follows this structure:

```yaml
---
category: "error_category"
priority: "high" | "medium" | "low"
success_count: 0
last_updated: "YYYY-MM-DD"
fingerprint: "unique_hash"
tags: ["tag1", "tag2"]
---

# Fix: Error Title

## Diagnosis
Description of when this error occurs and root causes.

## Solution
Step-by-step fix instructions.

## Code Template
```language
// Code examples
```

## Success Rate
Statistics about fix effectiveness.
```

## Usage

Runbooks are automatically loaded by the knowledge base service and matched against errors using:
1. **Exact fingerprint match** - Fastest, highest confidence
2. **Category + tag matching** - Fuzzy matching within same error category
3. **Semantic search** - Full-text search across all runbooks

## Creating New Runbooks

1. Identify a recurring error pattern
2. Create a new `.md` file in the appropriate category directory
3. Use the template above with YAML frontmatter
4. Test the runbook by triggering the error
5. Update `success_count` as the fix is applied

## Maintenance

- Update `last_updated` when modifying runbooks
- Increment `success_count` when fixes are successful
- Archive outdated runbooks to `_archive/` directory
