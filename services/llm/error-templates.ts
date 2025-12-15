/**
 * Error-specific prompt templates for better fix guidance
 * Provides context-aware examples based on error category
 */

export interface ErrorTemplate {
    pattern: string;
    example: string;
}

export const ERROR_TEMPLATES: Record<string, ErrorTemplate> = {
    dependency: {
        pattern: `For dependency errors, check package.json and lock files. Common fixes:
- Install missing package: npm install <package>
- Update package version in package.json
- Check for typos in import statements
- Verify package is in dependencies (not devDependencies)`,
        example: 'npm install express@latest'
    },

    syntax: {
        pattern: `For syntax errors, carefully check:
- Matching brackets, braces, and parentheses
- Semicolons (if required by style guide)
- String quotes (single vs double)
- Proper indentation
- Missing commas in objects/arrays`,
        example: 'Add missing closing brace at the end of function'
    },

    type: {
        pattern: `For type errors:
- Add null/undefined checks before accessing properties
- Verify property exists on object
- Check type compatibility in assignments
- Add type assertions if needed (TypeScript)
- Use optional chaining (?.)`,
        example: 'if (obj?.property) { ... } or const value = obj?.property ?? defaultValue;'
    },

    runtime: {
        pattern: `For runtime errors:
- Add error handling (try-catch blocks)
- Validate inputs before processing
- Check array bounds before accessing
- Handle async operations properly (await)
- Add defensive programming checks`,
        example: 'try { ... } catch (error) { console.error("Error:", error); }'
    },

    build: {
        pattern: `For build errors:
- Check TypeScript configuration (tsconfig.json)
- Verify all imports are correct
- Ensure all dependencies are installed
- Check for circular dependencies
- Review build tool configuration`,
        example: 'Fix import path or add missing type definitions'
    },

    test_failure: {
        pattern: `For test failures:
- Review test expectations vs actual behavior
- Check for timing issues (async/await)
- Verify test data setup
- Look for side effects from other tests
- Update snapshots if intentional changes`,
        example: 'Update test expectation or fix implementation to match expected behavior'
    },

    timeout: {
        pattern: `For timeout errors:
- Optimize slow operations
- Increase timeout threshold if reasonable
- Check for infinite loops
- Review async operation chains
- Add progress indicators for long operations`,
        example: 'Add timeout parameter or optimize database query'
    },

    configuration: {
        pattern: `For configuration errors:
- Verify environment variables are set
- Check configuration file syntax
- Ensure required fields are present
- Validate configuration values
- Review file permissions`,
        example: 'Set missing environment variable or fix config file syntax'
    }
};

/**
 * Get error-specific template for prompt generation
 */
export function getErrorTemplate(category: string): ErrorTemplate {
    const normalizedCategory = category.toLowerCase().replace(/[_-]/g, '_');

    return ERROR_TEMPLATES[normalizedCategory] || {
        pattern: 'Analyze the error carefully and apply the appropriate fix based on the error message and stack trace.',
        example: 'Review error details and implement targeted fix'
    };
}

/**
 * Get all available error categories
 */
export function getErrorCategories(): string[] {
    return Object.keys(ERROR_TEMPLATES);
}
