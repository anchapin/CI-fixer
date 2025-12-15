# CI-Fixer Prompt Templates

This directory contains LLM prompt templates for the CI-fixer agent, stored as Markdown files with YAML frontmatter for configuration.

## Structure

```
prompts/
├── diagnosis/       # Error diagnosis prompts
├── planning/        # Fix planning prompts
├── execution/       # Code generation prompts
└── verification/    # Fix validation prompts
```

## Template Format

Each prompt template uses YAML frontmatter for LLM configuration:

```yaml
---
version: "v1"
model: "gemini-3-pro-preview"
temperature: 0.7
max_tokens: 1024
response_format: "application/json"
description: "Brief description of what this prompt does"
variables: ["var1", "var2"]
---

Your prompt content here with {{variables}} using Handlebars syntax.

{{#if conditionalVar}}
Optional content
{{/if}}

{{#each arrayVar}}
- {{this}}
{{/each}}
```

## Handlebars Syntax

### Variables
```
{{variableName}}
```

### Conditionals
```
{{#if condition}}
  Content when true
{{else}}
  Content when false
{{/if}}
```

### Loops
```
{{#each items}}
  {{@index}}: {{this}}
{{/each}}
```

## Usage

```typescript
import { loadPrompt, renderPrompt } from './services/llm/prompt-loader.js';

// Load template
const template = await loadPrompt('diagnosis/error-diagnosis', 'v1');

// Render with variables
const prompt = await renderPrompt(template, {
    logSnippet: "Error logs...",
    repoContext: "Repository info..."
});

// Use in LLM call
const response = await unifiedGenerate(config, {
    contents: prompt,
    config: getPromptConfig(template),
    model: template.metadata.model
});
```

## Versioning

Templates support versioning for A/B testing:
- `error-diagnosis-v1.md` - Original version
- `error-diagnosis-v2.md` - Experimental version

Load specific version:
```typescript
const v1 = await loadPrompt('diagnosis/error-diagnosis', 'v1');
const v2 = await loadPrompt('diagnosis/error-diagnosis', 'v2');
```

## Best Practices

1. **Keep prompts focused** - One task per template
2. **Use descriptive variable names** - `{{errorMessage}}` not `{{msg}}`
3. **Document expected output** - Include format examples in prompt
4. **Version carefully** - Test new versions before replacing old ones
5. **Track performance** - Document which versions perform better
