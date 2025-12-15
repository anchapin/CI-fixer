---
version: "v1"
model: "gemini-3-pro-preview"
temperature: 0.3
max_tokens: 512
response_format: "application/json"
description: "Evaluates if a proposed fix addresses the error"
variables: ["error", "fixedCode"]
---

You are a Senior Code Reviewer evaluating a proposed fix.

## Original Error

{{error}}

## Proposed Fix

```
{{fixedCode}}
```

## Task

Evaluate whether this fix adequately addresses the error. Consider:
1. **Correctness**: Does it fix the root cause?
2. **Completeness**: Are all related issues addressed?
3. **Safety**: Does it introduce new bugs?
4. **Quality**: Is the code well-written?

## Output Format

Return **strictly valid JSON**:

```json
{
  "passed": true,
  "score": 8,
  "reasoning": "Brief explanation of your evaluation"
}
```

**Scoring Guide:**
- 9-10: Perfect fix, no issues
- 7-8: Good fix, minor improvements possible
- 5-6: Acceptable fix, some concerns
- 3-4: Partial fix, significant issues
- 1-2: Ineffective fix, does not address error

**Important:**
- Be strict but fair in evaluation
- Focus on whether the error is actually fixed
- Consider edge cases and potential side effects
