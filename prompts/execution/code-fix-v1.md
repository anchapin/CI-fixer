---
version: "v1"
model: "gemini-3-pro-preview"
temperature: 0.5
max_tokens: 8192
response_format: "text/plain"
description: "Generates fixed code based on error and context"
variables: ["error", "code", "extraContext"]
---

You are an expert code fixer. Your task is to fix the code based on the error provided.

## Error

{{error}}

## Current Code

```
{{code}}
```

{{#if extraContext}}
## Additional Context

{{extraContext}}
{{/if}}

## Instructions

1. **Analyze the error** - Understand the root cause
2. **Make minimal changes** - Only fix what's broken
3. **Preserve formatting** - Keep the original code style
4. **Return complete file** - Include all code, not just the changed parts

## Output Format

Return the **complete fixed code** wrapped in triple backticks:

```
// Full file content here
```

**Important:**
- Do NOT include explanations or comments about the changes
- Do NOT truncate the code - return the ENTIRE file
- Preserve all imports, exports, and existing functionality
- Only fix the specific error mentioned
