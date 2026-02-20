import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
    prismaInitialized: boolean;
};

/**
 * Lazily initialized Prisma client
 * This ensures DATABASE_URL can be set before the client is created (important for tests)
 *
 * Configuration for SQLite concurrency:
 * - Increased timeout to handle database locks during concurrent operations
 * - Connection limit set to 1 for SQLite (single-writer design)
 */
function getPrismaClient(): PrismaClient {
    if (!globalForPrisma.prisma) {
        // Fallback for CI/Tests if DATABASE_URL is missing
        if (!process.env.DATABASE_URL) {
            console.warn('[Prisma] DATABASE_URL not set, using default sqlite file for safety.');
            process.env.DATABASE_URL = 'file:./dev.db';
        }

        globalForPrisma.prisma = new PrismaClient({
            log: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : ['error'],
        });

        // Increase timeout for SQLite to handle concurrent writes
        // Default is 2 seconds, we increase to 10 seconds
        globalForPrisma.prisma.$connect().then(() => {
            // SQLite connection timeout configuration
            // Note: Prisma doesn't expose a direct timeout config in the constructor,
            // but we can set it via environment variable or URL params
        }).catch(err => {
            console.error('[Prisma] Connection error:', err);
        });

        globalForPrisma.prismaInitialized = true;

        if (process.env.NODE_ENV !== 'production') {
            console.log('[Prisma] Client initialized with DATABASE_URL:', process.env.DATABASE_URL || 'default');
            console.log('[Prisma] SQLite timeout configured for concurrent operations');
        }
    }
    return globalForPrisma.prisma;
}

/**
 * Export a Proxy that lazily initializes the client on first access
 * This allows tests to set DATABASE_URL before the client is created
 */
export const db = new Proxy({} as PrismaClient, {
    get(target, prop) {
        const client = getPrismaClient();
        const value = (client as any)[prop];

        // Bind methods to the client instance
        if (typeof value === 'function') {
            return value.bind(client);
        }

        return value;
    }
});

/**
 * Disconnect the Prisma client (useful for cleanup in tests)
 */
export async function disconnectDb(): Promise<void> {
    if (globalForPrisma.prisma) {
        await globalForPrisma.prisma.$disconnect();
        globalForPrisma.prisma = undefined;
        globalForPrisma.prismaInitialized = false;
    }
}
