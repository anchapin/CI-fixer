# Test Helpers Documentation

This directory contains shared test infrastructure to make writing tests easier, more consistent, and less verbose.

## Quick Start

```typescript
import { createMockGraphContext, cleanupMockContext } from '../helpers/test-fixtures.js';
import { GraphStateBuilder } from '../helpers/test-builders.js';
import { registerCustomMatchers } from '../helpers/custom-assertions.js';

// Register custom matchers once per test file
registerCustomMatchers();

describe('My Test Suite', () => {
    let context: GraphContext;

    beforeEach(async () => {
        context = await createMockGraphContext();
    });

    afterEach(async () => {
        await cleanupMockContext(context);
    });

    it('should do something', async () => {
        const state = new GraphStateBuilder()
            .withLogText('Error message')
            .atIteration(0)
            .build();

        const result = await myFunction(state, context);

        expect(result).toHaveTransitionedTo('planning');
    });
});
```

---

## Modules

### 1. test-fixtures.ts

Factory functions for creating mock objects with sensible defaults.

#### Mock Configuration

```typescript
import { createMockConfig } from '../helpers/test-fixtures.js';

// Use defaults
const config = createMockConfig();

// Override specific properties
const config = createMockConfig({
    repoUrl: 'https://github.com/my/repo',
    llmProvider: 'openai'
});
```

#### Mock State

```typescript
import { createMockGraphState } from '../helpers/test-fixtures.js';

const state = createMockGraphState({
    iteration: 2,
    currentLogText: 'Custom error message'
});
```

#### Mock Context

```typescript
import { createMockGraphContext, cleanupMockContext } from '../helpers/test-fixtures.js';

// Create context with mocked services
const context = await createMockGraphContext();

// With test database
const context = await createMockGraphContext({ dbClient: testDb });

// Always cleanup in afterEach
afterEach(async () => {
    await cleanupMockContext(context);
});
```

#### Mock Services

```typescript
import { createMockServices } from '../helpers/test-fixtures.js';

const services = createMockServices();

// All services are vi.fn() mocks, you can verify calls
expect(services.llm.unifiedGenerate).toHaveBeenCalled();

// Or override behavior
services.github.findClosestFile.mockResolvedValueOnce(null);
```

#### Other Factories

```typescript
import { 
    createMockWorkflowRun,
    createMockRunGroup,
    createMockDiagnosis,
    createMockClassification,
    createMockFileChange
} from '../helpers/test-fixtures.js';

const run = createMockWorkflowRun({ id: 456 });
const group = createMockRunGroup({ name: 'My Group' });
const diagnosis = createMockDiagnosis({ filePath: 'app.ts' });
const classification = createMockClassification({ category: 'syntax' });
const fileChange = createMockFileChange('src/app.ts', { status: 'modified' });
```

---

### 2. test-builders.ts

Builder pattern for fluent GraphState construction.

#### Basic Usage

```typescript
import { GraphStateBuilder } from '../helpers/test-builders.js';

const state = new GraphStateBuilder()
    .withLogText('Error: Cannot find module')
    .withDiagnosis({ filePath: 'app.ts', fixAction: 'edit' })
    .atIteration(1)
    .build();
```

#### All Available Methods

```typescript
const state = new GraphStateBuilder()
    // Configuration
    .withConfig({ repoUrl: 'custom/repo' })
    .withGroup({ id: 'group-1' })
    
    // Log text
    .withLogText('Current error message')
    .withInitialLogText('Initial error message')
    .withRepoContext('Repo context')
    
    // Artifacts
    .withDiagnosis({ filePath: 'app.ts', fixAction: 'edit', summary: 'Error' })
    .withClassification({ category: 'runtime', confidence: 0.9 })
    .withPlan('# Plan\n- Fix error')
    
    // Node state
    .atNode('planning')
    .atIteration(2)
    .withMaxIterations(5)
    .withStatus('working')
    .withFailureReason('Max iterations exceeded')
    
    // Files
    .withFileReservations(['app.ts', 'utils.ts'])
    .withFile('app.ts', { status: 'modified' })
    .withFiles({ 'app.ts': fileChange })
    
    // Feedback
    .withFeedback(['Previous attempt failed'])
    .addFeedback('New feedback message')
    
    // History
    .withHistory([{ node: 'analysis', action: 'diagnosed', result: 'success', timestamp: Date.now() }])
    .addHistoryEntry('planning', 'planned', 'success')
    
    // Other
    .withCurrentErrorFactId('fact-123')
    
    .build();
```

#### Resetting Builder

```typescript
const builder = new GraphStateBuilder();

const state1 = builder.withLogText('Error 1').build();
const state2 = builder.reset().withLogText('Error 2').build();
```

#### Convenience Function

```typescript
import { buildGraphState } from '../helpers/test-builders.js';

const state = buildGraphState()
    .withLogText('Error')
    .build();
```

---

### 3. custom-assertions.ts

Domain-specific Vitest matchers for better test assertions.

#### Setup

```typescript
import { registerCustomMatchers } from '../helpers/custom-assertions.js';

// Call once per test file (usually at top level)
registerCustomMatchers();
```

#### Available Matchers

##### toHaveTransitionedTo

Assert that a GraphState has transitioned to a specific node.

```typescript
const result = await analysisNode(state, context);
expect(result).toHaveTransitionedTo('planning');
```

##### toHaveDiagnosisMatching

Assert that a state has a diagnosis with specific properties.

```typescript
expect(result).toHaveDiagnosisMatching({
    filePath: 'app.ts',
    fixAction: 'edit'
});

// Supports regex matching (use string with / delimiters)
expect(result).toHaveDiagnosisMatching({
    summary: '/Cannot find module/'
});
```

##### toHaveReservedFiles

Assert that a state has specific file reservations.

```typescript
expect(result).toHaveReservedFiles(['app.ts', 'utils.ts']);
```

##### toHaveFeedbackContaining

Assert that a state has feedback containing specific text.

```typescript
expect(result).toHaveFeedbackContaining('Test Suite Failed');
```

##### toHaveLoggedMessage

Assert that a mock log callback was called with a specific message.

```typescript
expect(context.logCallback).toHaveLoggedMessage('INFO', 'Starting analysis');

// With regex
expect(context.logCallback).toHaveLoggedMessage('ERROR', /failed/i);
```

##### toHaveCreatedRecord

Assert that a database record was created with specific properties (async).

```typescript
await expect(testDb).toHaveCreatedRecord('errorFact', {
    summary: 'Error message',
    filePath: 'app.ts'
});
```

---

## Common Patterns

### Integration Test Setup

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { createMockGraphContext, cleanupMockContext } from '../helpers/test-fixtures.js';
import { GraphStateBuilder } from '../helpers/test-builders.js';
import { registerCustomMatchers } from '../helpers/custom-assertions.js';

registerCustomMatchers();

describe('My Integration Test', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: any;
    let context: GraphContext;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        context = await createMockGraphContext({ dbClient: testDb });
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
        await cleanupMockContext(context);
    });

    it('should do something', async () => {
        const state = new GraphStateBuilder()
            .withLogText('Error')
            .build();

        const result = await myFunction(state, context);

        expect(result).toHaveTransitionedTo('planning');
        await expect(testDb).toHaveCreatedRecord('errorFact', { summary: 'Error' });
    });
});
```

### Unit Test Setup

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createMinimalMockContext } from '../helpers/test-fixtures.js';
import { GraphStateBuilder } from '../helpers/test-builders.js';

describe('My Unit Test', () => {
    let context: GraphContext;

    beforeEach(() => {
        context = createMinimalMockContext();
    });

    it('should do something', () => {
        const state = new GraphStateBuilder()
            .withDiagnosis({ filePath: 'app.ts', fixAction: 'edit' })
            .build();

        const result = myFunction(state, context);

        expect(result).toBeDefined();
    });
});
```

### Testing Error Scenarios

```typescript
it('should handle LLM timeout', async () => {
    const mockLLM = vi.fn()
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ text: 'Success' });

    context.services.llm.unifiedGenerate = mockLLM;

    const state = new GraphStateBuilder()
        .withLogText('Error')
        .build();

    const result = await myFunction(state, context);

    expect(mockLLM).toHaveBeenCalledTimes(2);
    expect(result).toBeDefined();
});
```

### Testing State Transitions

```typescript
it('should transition through multiple nodes', async () => {
    let state = new GraphStateBuilder()
        .withLogText('Error')
        .atNode('analysis')
        .build();

    // Analysis
    state = { ...state, ...await analysisNode(state, context) };
    expect(state).toHaveTransitionedTo('planning');

    // Planning
    state = { ...state, ...await planningNode(state, context) };
    expect(state).toHaveTransitionedTo('execution');

    // Execution
    state = { ...state, ...await codingNode(state, context) };
    expect(state).toHaveTransitionedTo('verification');
});
```

---

## Best Practices

### 1. Use Builders for Complex State

**❌ Don't:**
```typescript
const state = {
    config: { /* 10 fields */ },
    group: { /* 5 fields */ },
    iteration: 0,
    // ... 20 more fields
};
```

**✅ Do:**
```typescript
const state = new GraphStateBuilder()
    .withLogText('Error')
    .atIteration(0)
    .build();
```

### 2. Use Custom Matchers

**❌ Don't:**
```typescript
expect(result).toBeDefined();
expect(result.currentNode).toBe('planning');
expect(result.diagnosis).toBeDefined();
expect(result.diagnosis.filePath).toBe('app.ts');
```

**✅ Do:**
```typescript
expect(result).toHaveTransitionedTo('planning');
expect(result).toHaveDiagnosisMatching({ filePath: 'app.ts' });
```

### 3. Use Factories for Consistency

**❌ Don't:**
```typescript
const config1 = { githubToken: 'token', repoUrl: 'url', selectedRuns: [] };
const config2 = { githubToken: 'token', repoUrl: 'url', selectedRuns: [] };
```

**✅ Do:**
```typescript
const config1 = createMockConfig();
const config2 = createMockConfig();
```

### 4. Always Cleanup

**❌ Don't:**
```typescript
beforeEach(async () => {
    context = await createMockGraphContext();
});
// No cleanup!
```

**✅ Do:**
```typescript
beforeEach(async () => {
    context = await createMockGraphContext();
});

afterEach(async () => {
    await cleanupMockContext(context);
});
```

---

## TypeScript Support

All helpers are fully typed. Your IDE will provide autocomplete and type checking:

```typescript
const state = new GraphStateBuilder()
    .withDiagnosis({
        filePath: 'app.ts',
        fixAction: 'edit', // Type-checked: 'edit' | 'command' | 'create'
        summary: 'Error'
    })
    .build();

// TypeScript knows the shape of state
state.diagnosis?.filePath; // string | null | undefined
```

---

## Examples

See these test files for real-world usage:

- [`graph-flow.test.ts`](file:///c:/Users/ancha/Documents/projects/CI-fixer/__tests__/integration/graph/graph-flow.test.ts) - Complete flow testing
- [`analysis-node-db.test.ts`](file:///c:/Users/ancha/Documents/projects/CI-fixer/__tests__/integration/graph/analysis-node-db.test.ts) - Node testing with DB
- [`error-scenarios.test.ts`](file:///c:/Users/ancha/Documents/projects/CI-fixer/__tests__/integration/error-scenarios.test.ts) - Error handling

---

## Contributing

When adding new helpers:

1. Add factory functions to `test-fixtures.ts`
2. Add builder methods to `test-builders.ts`
3. Add custom matchers to `custom-assertions.ts`
4. Update this README with examples
5. Add TypeScript types for autocomplete
