import { PrismaClient } from '@prisma/client';
import { ClassifiedError } from '../errorClassification.js';
import { db as prisma } from '../db/client.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SuggestedAction {
    template: {
        id: string;
        errorCategory: string;
        filePattern: string;
        actionType: string;
        template: string;
        frequency: number;
        successRate: number;
    };
    confidence: number; // 0.0 - 1.0
    reasoning: string;
}

// ============================================================================
// ACTION TRACKING
// ============================================================================

/**
 * Records when an action is used by the agent.
 * Updates frequency and success rate statistics.
 */
export async function recordActionUsage(
    errorCategory: string,
    filePattern: string,
    actionType: string,
    success: boolean
): Promise<void> {
    const existing = await prisma.actionTemplate.findFirst({
        where: {
            errorCategory,
            filePattern,
            actionType
        }
    });

    if (existing) {
        const newFrequency = existing.frequency + 1;
        const successIncrement = success ? 1.0 : 0.0;
        const newSuccessRate = ((existing.successRate * existing.frequency) + successIncrement) / newFrequency;

        await prisma.actionTemplate.update({
            where: { id: existing.id },
            data: {
                frequency: newFrequency,
                successRate: newSuccessRate,
                lastUsed: new Date()
            }
        });
    }
}

// ============================================================================
// ACTION SUGGESTIONS
// ============================================================================

/**
 * Determines if a file matches a pattern (supports wildcards).
 */
function matchesPattern(filePath: string, pattern: string): boolean {
    if (pattern === '*') return true;

    const fileBasename = filePath.split('/').pop() || filePath;

    // Convert glob pattern to regex
    const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(fileBasename) || regex.test(filePath);
}

/**
 * Gets suggested actions for a given error and file.
 * Returns top N suggestions ranked by frequency and success rate.
 */
export async function getSuggestedActions(
    classifiedError: ClassifiedError,
    filePath: string,
    limit: number = 3
): Promise<SuggestedAction[]> {
    // Get all templates for this error category
    const templates = await prisma.actionTemplate.findMany({
        where: {
            errorCategory: classifiedError.category
        },
        orderBy: [
            { frequency: 'desc' },
            { successRate: 'desc' }
        ]
    });

    // Filter by file pattern match and calculate confidence
    const suggestions: SuggestedAction[] = templates
        .filter(template => matchesPattern(filePath, template.filePattern))
        .map(template => {
            // Confidence based on frequency and success rate
            const frequencyScore = Math.min(template.frequency / 10, 1.0); // Normalize to 0-1
            const confidence = (template.successRate * 0.7) + (frequencyScore * 0.3);

            let reasoning = `This action has been used ${template.frequency} time(s) with ${(template.successRate * 100).toFixed(0)}% success rate`;
            if (template.frequency < 3) {
                reasoning += ' (limited history)';
            }

            return {
                template,
                confidence,
                reasoning
            };
        })
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);

    return suggestions;
}

// ============================================================================
// ACTION TEMPLATE MANAGEMENT
// ============================================================================

/**
 * Adds a new action template to the library.
 * Can be used to seed common fixes or add discovered patterns.
 */
export async function addActionTemplate(
    errorCategory: string,
    filePattern: string,
    actionType: string,
    template: string
): Promise<any> {
    // Check if already exists
    const existing = await prisma.actionTemplate.findFirst({
        where: {
            errorCategory,
            filePattern,
            actionType
        }
    });

    if (existing) {
        return existing;
    }

    return await prisma.actionTemplate.create({
        data: {
            errorCategory,
            filePattern,
            actionType,
            template,
            frequency: 0,
            successRate: 0.0
        }
    });
}

/**
 * Gets all action templates, optionally filtered by category.
 */
export async function getActionTemplates(errorCategory?: string) {
    return await prisma.actionTemplate.findMany({
        where: errorCategory ? { errorCategory } : undefined,
        orderBy: [
            { frequency: 'desc' },
            { successRate: 'desc' }
        ]
    });
}

/**
 * Seeds the action library with common fixes.
 * Should be called on first run to populate initial templates.
 */
export async function seedActionLibrary(): Promise<void> {
    const commonActions = [
        {
            errorCategory: 'dependency',
            filePattern: 'package.json',
            actionType: 'install_deps',
            template: 'npm install'
        },
        {
            errorCategory: 'dependency',
            filePattern: 'package-lock.json',
            actionType: 'clean_install',
            template: 'npm ci'
        },
        {
            errorCategory: 'syntax',
            filePattern: '*.ts',
            actionType: 'fix_syntax',
            template: 'Fix TypeScript syntax error at indicated line'
        },
        {
            errorCategory: 'syntax',
            filePattern: '*.js',
            actionType: 'fix_syntax',
            template: 'Fix JavaScript syntax error at indicated line'
        },
        {
            errorCategory: 'build',
            filePattern: 'tsconfig.json',
            actionType: 'update_config',
            template: 'Update TypeScript configuration'
        },
        {
            errorCategory: 'test_failure',
            filePattern: '*.test.ts',
            actionType: 'update_test',
            template: 'Update test expectations or fix test logic'
        },
        {
            errorCategory: 'test_failure',
            filePattern: '*.spec.ts',
            actionType: 'update_test',
            template: 'Update test expectations or fix test logic'
        },
        {
            errorCategory: 'runtime',
            filePattern: '*.ts',
            actionType: 'add_null_check',
            template: 'Add null/undefined checks for runtime errors'
        },
        {
            errorCategory: 'timeout',
            filePattern: '*',
            actionType: 'increase_timeout',
            template: 'Increase timeout limits in configuration'
        },
        {
            errorCategory: 'configuration',
            filePattern: '*.yml',
            actionType: 'fix_yaml',
            template: 'Fix YAML syntax or configuration values'
        }
    ];

    for (const action of commonActions) {
        await addActionTemplate(
            action.errorCategory,
            action.filePattern,
            action.actionType,
            action.template
        );
    }

    console.log(`Seeded ${commonActions.length} action templates`);
}
