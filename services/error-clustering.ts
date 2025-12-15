import { db } from '../db/client.js';
import crypto from 'crypto';

/**
 * Generates a fingerprint for error clustering.
 * Uses category, error message pattern, and affected files.
 */
export function generateErrorFingerprint(
    category: string,
    errorMessage: string,
    affectedFiles: string[]
): string {
    // Normalize error message by removing specific values (line numbers, IDs, etc.)
    const normalized = errorMessage
        .replace(/\d+/g, 'N') // Replace numbers with N
        .replace(/0x[0-9a-f]+/gi, '0xHEX') // Replace hex addresses
        .replace(/['"]/g, '') // Remove quotes
        .toLowerCase()
        .trim();

    const fingerprint = `${category}:${normalized}:${affectedFiles.sort().join(',')}`;
    return crypto.createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
}

/**
 * Adds an error to a cluster or creates a new cluster.
 * Returns the cluster ID.
 */
export async function clusterError(
    errorFactId: string,
    category: string,
    errorMessage: string,
    affectedFiles: string[]
): Promise<string> {
    const fingerprint = generateErrorFingerprint(category, errorMessage, affectedFiles);

    // Check if cluster exists
    const existingCluster = await db.errorCluster.findUnique({
        where: { fingerprint }
    });

    if (existingCluster) {
        // Update existing cluster
        const errorFactIds = JSON.parse(existingCluster.errorFactIds);
        if (!errorFactIds.includes(errorFactId)) {
            errorFactIds.push(errorFactId);
        }

        await db.errorCluster.update({
            where: { id: existingCluster.id },
            data: {
                occurrenceCount: existingCluster.occurrenceCount + 1,
                lastSeen: new Date(),
                errorFactIds: JSON.stringify(errorFactIds)
            }
        });

        console.log(`[ErrorClustering] Added to existing cluster ${existingCluster.id} (${existingCluster.occurrenceCount + 1} occurrences)`);
        return existingCluster.id;
    } else {
        // Create new cluster
        const newCluster = await db.errorCluster.create({
            data: {
                fingerprint,
                category,
                occurrenceCount: 1,
                errorFactIds: JSON.stringify([errorFactId]),
                commonPattern: errorMessage.substring(0, 200) // Store first 200 chars as pattern
            }
        });

        console.log(`[ErrorClustering] Created new cluster ${newCluster.id}`);
        return newCluster.id;
    }
}

/**
 * Finds recurring error patterns across all runs.
 * Returns clusters sorted by occurrence count.
 */
export async function findRecurringPatterns(
    minOccurrences: number = 2,
    limit: number = 20
): Promise<Array<{
    id: string;
    fingerprint: string;
    category: string;
    occurrenceCount: number;
    firstSeen: Date;
    lastSeen: Date;
    commonPattern: string | null;
}>> {
    const clusters = await db.errorCluster.findMany({
        where: {
            occurrenceCount: {
                gte: minOccurrences
            }
        },
        orderBy: {
            occurrenceCount: 'desc'
        },
        take: limit
    });

    return clusters;
}

/**
 * Gets the complete history of a recurring error cluster.
 * Returns all error facts associated with this cluster.
 */
export async function getClusterHistory(clusterId: string): Promise<Array<{
    id: string;
    summary: string;
    filePath: string;
    status: string;
    runId: string;
    createdAt: Date;
}>> {
    const cluster = await db.errorCluster.findUnique({
        where: { id: clusterId }
    });

    if (!cluster) {
        return [];
    }

    const errorFactIds = JSON.parse(cluster.errorFactIds);

    const errorFacts = await db.errorFact.findMany({
        where: {
            id: {
                in: errorFactIds
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    return errorFacts.map(error => ({
        id: error.id,
        summary: error.summary,
        filePath: error.filePath,
        status: error.status,
        runId: error.runId,
        createdAt: error.createdAt
    }));
}

/**
 * Analyzes trends for a specific error cluster.
 * Returns statistics about occurrence frequency over time.
 */
export async function analyzeClusterTrends(clusterId: string): Promise<{
    totalOccurrences: number;
    firstSeen: Date;
    lastSeen: Date;
    averageTimeBetweenOccurrences: number; // in hours
    trend: 'increasing' | 'decreasing' | 'stable';
    resolvedCount: number;
    unresolvedCount: number;
}> {
    const cluster = await db.errorCluster.findUnique({
        where: { id: clusterId }
    });

    if (!cluster) {
        throw new Error(`Cluster ${clusterId} not found`);
    }

    const errorFactIds = JSON.parse(cluster.errorFactIds);
    const errorFacts = await db.errorFact.findMany({
        where: {
            id: {
                in: errorFactIds
            }
        },
        orderBy: {
            createdAt: 'asc'
        }
    });

    const resolvedCount = errorFacts.filter(e => e.status === 'resolved').length;
    const unresolvedCount = errorFacts.length - resolvedCount;

    // Calculate average time between occurrences
    let totalTimeDiff = 0;
    for (let i = 1; i < errorFacts.length; i++) {
        const diff = errorFacts[i].createdAt.getTime() - errorFacts[i - 1].createdAt.getTime();
        totalTimeDiff += diff;
    }
    const averageTimeBetweenOccurrences = errorFacts.length > 1
        ? totalTimeDiff / (errorFacts.length - 1) / (1000 * 60 * 60) // Convert to hours
        : 0;

    // Determine trend (simple heuristic: compare first half vs second half)
    const midpoint = Math.floor(errorFacts.length / 2);
    const firstHalf = errorFacts.slice(0, midpoint);
    const secondHalf = errorFacts.slice(midpoint);

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (errorFacts.length >= 4) {
        const firstHalfTime = firstHalf[firstHalf.length - 1].createdAt.getTime() - firstHalf[0].createdAt.getTime();
        const secondHalfTime = secondHalf[secondHalf.length - 1].createdAt.getTime() - secondHalf[0].createdAt.getTime();

        if (secondHalfTime > 0 && firstHalfTime > 0) {
            const firstHalfRate = firstHalf.length / firstHalfTime;
            const secondHalfRate = secondHalf.length / secondHalfTime;

            if (secondHalfRate > firstHalfRate * 1.5) {
                trend = 'increasing';
            } else if (secondHalfRate < firstHalfRate * 0.67) {
                trend = 'decreasing';
            }
        }
    }

    return {
        totalOccurrences: cluster.occurrenceCount,
        firstSeen: cluster.firstSeen,
        lastSeen: cluster.lastSeen,
        averageTimeBetweenOccurrences,
        trend,
        resolvedCount,
        unresolvedCount
    };
}

/**
 * Gets all clusters for a specific error category.
 */
export async function getClustersByCategory(category: string): Promise<Array<{
    id: string;
    fingerprint: string;
    occurrenceCount: number;
    commonPattern: string | null;
}>> {
    const clusters = await db.errorCluster.findMany({
        where: { category },
        orderBy: {
            occurrenceCount: 'desc'
        }
    });

    return clusters.map(c => ({
        id: c.id,
        fingerprint: c.fingerprint,
        occurrenceCount: c.occurrenceCount,
        commonPattern: c.commonPattern
    }));
}
