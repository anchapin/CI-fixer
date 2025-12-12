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
 */
function getPrismaClient(): PrismaClient {
    if (!globalForPrisma.prisma) {
        globalForPrisma.prisma = new PrismaClient();
        globalForPrisma.prismaInitialized = true;

        if (process.env.NODE_ENV !== 'production') {
            console.log('[Prisma] Client initialized with DATABASE_URL:', process.env.DATABASE_URL || 'default');
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
