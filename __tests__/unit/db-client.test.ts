import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, disconnectDb } from '../../db/client.js';

describe('Database Client', () => {
    beforeEach(() => {
        // Clear any existing Prisma client
        const globalForPrisma = globalThis as any;
        if (globalForPrisma.prisma) {
            globalForPrisma.prisma = undefined;
            globalForPrisma.prismaInitialized = false;
        }
    });

    afterEach(async () => {
        await disconnectDb();
    });

    describe('db proxy', () => {
        it('should lazily initialize Prisma client on first access', () => {
            const globalForPrisma = globalThis as any;
            expect(globalForPrisma.prisma).toBeUndefined();

            // Access a property to trigger initialization
            const client = db.$connect;

            expect(globalForPrisma.prisma).toBeDefined();
            expect(globalForPrisma.prismaInitialized).toBe(true);
        });

        it('should return the same client instance on multiple accesses', () => {
            const client1 = db.$connect;
            const client2 = db.$disconnect;

            const globalForPrisma = globalThis as any;
            expect(globalForPrisma.prisma).toBeDefined();
        });

        it('should bind methods to client instance', async () => {
            // Access a method property
            const connectMethod = db.$connect;

            expect(typeof connectMethod).toBe('function');
        });

        it('should log initialization in non-production environment', () => {
            const consoleSpy = vi.spyOn(console, 'log');
            const originalEnv = process.env.NODE_ENV;

            process.env.NODE_ENV = 'development';

            // Trigger initialization
            const client = db.$connect;

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Prisma] Client initialized'),
                expect.any(String)
            );

            process.env.NODE_ENV = originalEnv;
            consoleSpy.mockRestore();
        });
    });

    describe('disconnectDb', () => {
        it('should disconnect existing Prisma client', async () => {
            // Initialize client
            const client = db.$connect;

            const globalForPrisma = globalThis as any;
            expect(globalForPrisma.prisma).toBeDefined();

            // Disconnect
            await disconnectDb();

            expect(globalForPrisma.prisma).toBeUndefined();
            expect(globalForPrisma.prismaInitialized).toBe(false);
        });

        it('should handle disconnect when no client exists', async () => {
            const globalForPrisma = globalThis as any;
            globalForPrisma.prisma = undefined;

            // Should not throw
            await expect(disconnectDb()).resolves.not.toThrow();
        });

        it('should call $disconnect on the client', async () => {
            // Initialize client
            const client = db.$connect;

            const globalForPrisma = globalThis as any;
            const disconnectSpy = vi.spyOn(globalForPrisma.prisma, '$disconnect');

            await disconnectDb();

            expect(disconnectSpy).toHaveBeenCalled();
        });
    });
});
