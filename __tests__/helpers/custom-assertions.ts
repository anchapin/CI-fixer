import { expect } from 'vitest';
import type { MatcherFunction } from 'vitest';

/**
 * Custom matchers for test assertions
 */

/**
 * Assert that a GraphState has transitioned to a specific node
 */
export const toHaveTransitionedTo: MatcherFunction = function (received: any, expectedNode: string) {
    const pass = received?.currentNode === expectedNode;

    return {
        pass,
        message: () => pass
            ? `Expected state not to have transitioned to ${expectedNode}, but it did`
            : `Expected state to have transitioned to ${expectedNode}, but got ${received?.currentNode}`,
        actual: received?.currentNode,
        expected: expectedNode
    };
};

/**
 * Assert that a state has a diagnosis with specific properties
 */
export const toHaveDiagnosisMatching: MatcherFunction = function (received: any, expected: Partial<any>) {
    const diagnosis = received?.diagnosis;

    if (!diagnosis) {
        return {
            pass: false,
            message: () => 'Expected state to have a diagnosis, but it was undefined',
            actual: undefined,
            expected
        };
    }

    const matches = Object.entries(expected).every(([key, value]) => {
        if (typeof value === 'string' && value.startsWith('/') && value.endsWith('/')) {
            // Regex matching
            const regex = new RegExp(value.slice(1, -1));
            return regex.test(diagnosis[key]);
        }
        return diagnosis[key] === value;
    });

    return {
        pass: matches,
        message: () => matches
            ? `Expected diagnosis not to match ${JSON.stringify(expected)}`
            : `Expected diagnosis to match ${JSON.stringify(expected)}, but got ${JSON.stringify(diagnosis)}`,
        actual: diagnosis,
        expected
    };
};

/**
 * Assert that a state has specific file reservations
 */
export const toHaveReservedFiles: MatcherFunction = function (received: any, expectedFiles: string[]) {
    const reservations = received?.fileReservations || [];
    const pass = expectedFiles.every(file => reservations.includes(file));

    return {
        pass,
        message: () => pass
            ? `Expected state not to have reserved files ${expectedFiles.join(', ')}`
            : `Expected state to have reserved files ${expectedFiles.join(', ')}, but got ${reservations.join(', ')}`,
        actual: reservations,
        expected: expectedFiles
    };
};

/**
 * Assert that a state has feedback containing specific text
 */
export const toHaveFeedbackContaining: MatcherFunction = function (received: any, expectedText: string) {
    const feedback = received?.feedback || [];
    const pass = feedback.some((f: string) => f.includes(expectedText));

    return {
        pass,
        message: () => pass
            ? `Expected feedback not to contain "${expectedText}"`
            : `Expected feedback to contain "${expectedText}", but got: ${feedback.join('; ')}`,
        actual: feedback,
        expected: expectedText
    };
};

/**
 * Assert that a mock function was called with a log message containing specific text
 */
export const toHaveLoggedMessage: MatcherFunction = function (received: any, level: string, messagePattern: string | RegExp) {
    if (typeof received !== 'function' || !received.mock) {
        return {
            pass: false,
            message: () => 'Expected a mock function',
            actual: received,
            expected: 'Mock function'
        };
    }

    const calls = received.mock.calls;
    const pattern = typeof messagePattern === 'string' ? new RegExp(messagePattern) : messagePattern;

    const found = calls.some((call: any[]) => {
        return call[0] === level && pattern.test(call[1]);
    });

    return {
        pass: found,
        message: () => found
            ? `Expected not to have logged ${level} message matching ${pattern}`
            : `Expected to have logged ${level} message matching ${pattern}, but didn't find it in calls: ${JSON.stringify(calls)}`,
        actual: calls,
        expected: `[${level}, ${pattern}]`
    };
};

/**
 * Assert that a database record was created with specific properties
 */
export const toHaveCreatedRecord: MatcherFunction = async function (received: any, tableName: string, expectedProps: any) {
    if (!received || !received[tableName]) {
        return {
            pass: false,
            message: () => `Expected database client to have table ${tableName}`,
            actual: received,
            expected: tableName
        };
    }

    try {
        const records = await received[tableName].findMany({
            where: expectedProps
        });

        const pass = records.length > 0;

        return {
            pass,
            message: () => pass
                ? `Expected not to find record in ${tableName} with ${JSON.stringify(expectedProps)}`
                : `Expected to find record in ${tableName} with ${JSON.stringify(expectedProps)}, but found none`,
            actual: records,
            expected: expectedProps
        };
    } catch (error) {
        return {
            pass: false,
            message: () => `Error querying database: ${error}`,
            actual: error,
            expected: expectedProps
        };
    }
};

/**
 * Register all custom matchers
 */
export function registerCustomMatchers() {
    expect.extend({
        toHaveTransitionedTo,
        toHaveDiagnosisMatching,
        toHaveReservedFiles,
        toHaveFeedbackContaining,
        toHaveLoggedMessage,
        toHaveCreatedRecord
    });
}

// Type declarations for TypeScript
declare module 'vitest' {
    interface Assertion<T = any> {
        toHaveTransitionedTo(expectedNode: string): T;
        toHaveDiagnosisMatching(expected: Partial<any>): T;
        toHaveReservedFiles(expectedFiles: string[]): T;
        toHaveFeedbackContaining(expectedText: string): T;
        toHaveLoggedMessage(level: string, messagePattern: string | RegExp): T;
        toHaveCreatedRecord(tableName: string, expectedProps: any): Promise<T>;
    }
    interface AsymmetricMatchersContaining {
        toHaveTransitionedTo(expectedNode: string): any;
        toHaveDiagnosisMatching(expected: Partial<any>): any;
        toHaveReservedFiles(expectedFiles: string[]): any;
        toHaveFeedbackContaining(expectedText: string): any;
        toHaveLoggedMessage(level: string, messagePattern: string | RegExp): any;
        toHaveCreatedRecord(tableName: string, expectedProps: any): any;
    }
}
