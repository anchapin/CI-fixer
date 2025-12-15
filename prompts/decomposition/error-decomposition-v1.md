---
model: gemini-2.5-flash
temperature: 0.3
responseMimeType: application/json
maxOutputTokens: 2048
---

# Error Decomposition

You are analyzing a CI error to decompose it into independent sub-problems that can be solved efficiently.

## Error Information

**Diagnosis**: {{diagnosis}}

**Error Category**: {{category}}

**Complexity Score**: {{complexity}}

**Affected Files**: {{affectedFiles}}

{{#if feedbackHistory}}
**Previous Attempts**:
{{feedbackHistory}}
{{/if}}

## Your Task

Analyze this error and determine if it should be decomposed into multiple sub-problems.

### Decomposition Criteria

Only decompose if ALL of the following are true:
1. There are 2+ distinct, separable problems
2. Some problems can be solved independently (in parallel)
3. The complexity score is > 8

### Output Format

Return JSON with this structure:

```json
{
  "shouldDecompose": boolean,
  "reasoning": "brief explanation",
  "nodes": [
    {
      "id": "node-1",
      "problem": "concise description (max 100 chars)",
      "category": "DEPENDENCY|SYNTAX|CONFIG|ENVIRONMENT|LOGIC|etc",
      "affectedFiles": ["file1.ts"],
      "dependencies": [],
      "priority": 1,
      "complexity": 3
    }
  ],
  "edges": [
    {"from": "node-1", "to": "node-2"}
  ]
}
```

### Rules

1. **Node IDs**: Use simple identifiers like "node-1", "node-2", etc.
2. **Problem Descriptions**: Be concise and actionable
3. **Dependencies**: Only add if node B truly requires node A to complete first
4. **Priority**: 
   - Priority 1 = can start immediately (no dependencies)
   - Priority 2 = depends on priority 1 nodes
   - Priority 3 = depends on priority 2 nodes, etc.
5. **Complexity**: Estimate 1-10 for each sub-problem
6. **Independent Nodes**: Nodes with no dependencies should have the same priority
7. **No Cycles**: Ensure dependency graph is acyclic
8. **Idempotent Commands**: If suggesting commands, prefer idempotent ones (ln -sf, mkdir -p)

### Examples

**Example 1: Multi-Error (Should Decompose)**
```
Diagnosis: "Tests fail due to missing pytest, Python 3.7 (need 3.8+), and import errors"
Complexity: 12

Output:
{
  "shouldDecompose": true,
  "reasoning": "Three distinct problems: dependency, environment, and imports. First two are independent.",
  "nodes": [
    {
      "id": "node-1",
      "problem": "Update Python to 3.8+ in CI workflow",
      "category": "ENVIRONMENT",
      "affectedFiles": [".github/workflows/test.yml"],
      "dependencies": [],
      "priority": 1,
      "complexity": 3
    },
    {
      "id": "node-2",
      "problem": "Install pytest in requirements.txt",
      "category": "DEPENDENCY",
      "affectedFiles": ["requirements.txt"],
      "dependencies": [],
      "priority": 1,
      "complexity": 2
    },
    {
      "id": "node-3",
      "problem": "Fix import errors in test_api.py",
      "category": "IMPORT",
      "affectedFiles": ["tests/test_api.py"],
      "dependencies": ["node-2"],
      "priority": 2,
      "complexity": 2
    }
  ],
  "edges": [
    {"from": "node-2", "to": "node-3"}
  ]
}
```

**Example 2: Single Error (Should NOT Decompose)**
```
Diagnosis: "Syntax error: missing semicolon in utils.ts"
Complexity: 2

Output:
{
  "shouldDecompose": false,
  "reasoning": "Single, simple syntax error. No benefit from decomposition.",
  "nodes": [],
  "edges": []
}
```

Now analyze the error and provide your decomposition analysis.
