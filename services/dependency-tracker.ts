import { db } from '../db/client.js';

export type RelationshipType = 'blocks' | 'discovered_from' | 'related' | 'parent_child';
export type ErrorStatus = 'open' | 'in_progress' | 'resolved' | 'blocked';

export interface ErrorDependencyInput {
    sourceErrorId: string;
    targetErrorId: string;
    relationshipType: RelationshipType;
    metadata?: Record<string, any>;
}

export interface DependencyGraph {
    nodes: Array<{ id: string; summary: string; status: string; filePath: string }>;
    edges: Array<{ from: string; to: string; type: string; metadata?: any }>;
}

export interface ErrorWithDependencies {
    id: string;
    summary: string;
    status: string;
    filePath: string;
    blockedBy: Array<{ id: string; summary: string; relationshipType: string }>;
    blocking: Array<{ id: string; summary: string; relationshipType: string }>;
}

/**
 * Records a dependency relationship between two errors.
 * This enables tracking of blocks, discovered-from, and other relationships.
 */
export async function recordErrorDependency(input: ErrorDependencyInput): Promise<void> {
    const { sourceErrorId, targetErrorId, relationshipType, metadata } = input;

    // Prevent self-dependencies
    if (sourceErrorId === targetErrorId) {
        console.warn('[DependencyTracker] Cannot create self-dependency');
        return;
    }

    // Check if dependency already exists
    const existing = await db.errorDependency.findFirst({
        where: {
            sourceErrorId,
            targetErrorId,
            relationshipType
        }
    });

    if (existing) {
        console.debug('[DependencyTracker] Dependency already exists');
        return;
    }

    await db.errorDependency.create({
        data: {
            sourceErrorId,
            targetErrorId,
            relationshipType,
            metadata: metadata ? JSON.stringify(metadata) : null
        }
    });

    console.log(`[DependencyTracker] Recorded ${relationshipType} dependency: ${sourceErrorId} -> ${targetErrorId}`);

    // If this is a "blocks" relationship, update source error status
    if (relationshipType === 'blocks') {
        await db.errorFact.update({
            where: { id: sourceErrorId },
            data: { status: 'blocked' }
        });
    }
}

/**
 * Gets all errors that are blocked by unresolved dependencies.
 * Returns errors with status 'blocked' or that have blocking dependencies.
 */
export async function getBlockedErrors(errorId?: string): Promise<ErrorWithDependencies[]> {
    const where = errorId ? { id: errorId } : { status: 'blocked' };

    const errors = await db.errorFact.findMany({
        where,
        include: {
            blockedBy: {
                include: {
                    targetError: true
                }
            },
            blocking: {
                include: {
                    sourceError: true
                }
            }
        }
    });

    return errors
        .map(error => ({
            id: error.id,
            summary: error.summary,
            status: error.status,
            filePath: error.filePath,
            blockedBy: error.blockedBy
                .filter(dep => dep.targetError.status !== 'resolved')
                .map(dep => ({
                    id: dep.targetError.id,
                    summary: dep.targetError.summary,
                    relationshipType: dep.relationshipType
                })),
            blocking: error.blocking.map(dep => ({
                id: dep.sourceError.id,
                summary: dep.sourceError.summary,
                relationshipType: dep.relationshipType
            }))
        }))
        .filter(error => error.blockedBy.length > 0); // Only return errors that still have unresolved blockers
}

/**
 * Gets all errors that are ready to work on (no blocking dependencies).
 * Filters for errors with status 'open' and no unresolved blockers.
 */
export async function getReadyErrors(runId?: string): Promise<ErrorWithDependencies[]> {
    const where: any = {
        status: { in: ['open', 'in_progress'] }
    };

    if (runId) {
        where.runId = runId;
    }

    const errors = await db.errorFact.findMany({
        where,
        include: {
            blockedBy: {
                include: {
                    targetError: true
                }
            },
            blocking: {
                include: {
                    sourceError: true
                }
            }
        }
    });

    // Filter out errors that have unresolved blocking dependencies
    const readyErrors = errors.filter(error => {
        const hasUnresolvedBlockers = error.blockedBy.some(
            dep => dep.relationshipType === 'blocks' && dep.targetError.status !== 'resolved'
        );
        return !hasUnresolvedBlockers;
    });

    return readyErrors.map(error => ({
        id: error.id,
        summary: error.summary,
        status: error.status,
        filePath: error.filePath,
        blockedBy: error.blockedBy.map(dep => ({
            id: dep.targetError.id,
            summary: dep.targetError.summary,
            relationshipType: dep.relationshipType
        })),
        blocking: error.blocking.map(dep => ({
            id: dep.sourceError.id,
            summary: dep.sourceError.summary,
            relationshipType: dep.relationshipType
        }))
    }));
}

/**
 * Gets all errors discovered from a source error.
 * Useful for building audit trails and understanding error discovery chains.
 */
export async function getDiscoveredErrors(sourceErrorId: string): Promise<ErrorWithDependencies[]> {
    const dependencies = await db.errorDependency.findMany({
        where: {
            targetErrorId: sourceErrorId,
            relationshipType: 'discovered_from'
        },
        include: {
            sourceError: {
                include: {
                    blockedBy: {
                        include: {
                            targetError: true
                        }
                    },
                    blocking: {
                        include: {
                            sourceError: true
                        }
                    }
                }
            }
        }
    });

    return dependencies.map(dep => ({
        id: dep.sourceError.id,
        summary: dep.sourceError.summary,
        status: dep.sourceError.status,
        filePath: dep.sourceError.filePath,
        blockedBy: dep.sourceError.blockedBy.map(b => ({
            id: b.targetError.id,
            summary: b.targetError.summary,
            relationshipType: b.relationshipType
        })),
        blocking: dep.sourceError.blocking.map(b => ({
            id: b.sourceError.id,
            summary: b.sourceError.summary,
            relationshipType: b.relationshipType
        }))
    }));
}

/**
 * Marks an error as in progress.
 */
export async function markErrorInProgress(errorId: string): Promise<void> {
    await db.errorFact.update({
        where: { id: errorId },
        data: {
            status: 'in_progress',
            updatedAt: new Date()
        }
    });
}

/**
 * Marks an error as resolved and unblocks any dependent errors.
 */
export async function markErrorResolved(
    errorId: string,
    resolution?: {
        resolution: string;
        filesChanged: string[];
        iterations: number;
        finalApproach: string;
    }
): Promise<void> {
    // Update error status
    await db.errorFact.update({
        where: { id: errorId },
        data: {
            status: 'resolved',
            updatedAt: new Date(),
            notes: resolution ? JSON.stringify({
                ...JSON.parse((await db.errorFact.findUnique({ where: { id: errorId } }))?.notes || '{}'),
                resolution
            }) : undefined
        }
    });

    // Find all errors blocked by this error
    const blockedErrors = await db.errorDependency.findMany({
        where: {
            targetErrorId: errorId,
            relationshipType: 'blocks'
        },
        include: {
            sourceError: {
                include: {
                    blockedBy: {
                        include: {
                            targetError: true
                        }
                    }
                }
            }
        }
    });

    // Unblock errors if they have no other unresolved blockers
    for (const dep of blockedErrors) {
        const otherBlockers = dep.sourceError.blockedBy.filter(
            b => b.targetError.id !== errorId && b.targetError.status !== 'resolved'
        );

        if (otherBlockers.length === 0) {
            await db.errorFact.update({
                where: { id: dep.sourceError.id },
                data: { status: 'open' }
            });
            console.log(`[DependencyTracker] Unblocked error: ${dep.sourceError.id}`);
        }
    }
}

/**
 * Builds a dependency graph for visualization.
 * Returns nodes (errors) and edges (dependencies).
 */
export async function buildDependencyGraph(runId?: string): Promise<DependencyGraph> {
    const where = runId ? { runId } : {};

    const errors = await db.errorFact.findMany({
        where,
        include: {
            blockedBy: true,
            blocking: true
        }
    });

    const nodes = errors.map(error => ({
        id: error.id,
        summary: error.summary,
        status: error.status,
        filePath: error.filePath
    }));

    const edges: DependencyGraph['edges'] = [];
    for (const error of errors) {
        for (const dep of error.blockedBy) {
            edges.push({
                from: dep.targetErrorId,
                to: error.id,
                type: dep.relationshipType,
                metadata: dep.metadata ? JSON.parse(dep.metadata) : undefined
            });
        }
    }

    return { nodes, edges };
}

/**
 * Checks if an error has any blocking dependencies.
 */
export async function hasBlockingDependencies(errorId: string): Promise<boolean> {
    const error = await db.errorFact.findUnique({
        where: { id: errorId },
        include: {
            blockedBy: {
                include: {
                    targetError: true
                }
            }
        }
    });

    if (!error) return false;

    return error.blockedBy.some(
        dep => dep.relationshipType === 'blocks' && dep.targetError.status !== 'resolved'
    );
}
