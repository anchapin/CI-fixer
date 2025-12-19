import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataIngestionService } from '../../services/DataIngestionService.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

describe('DataIngestionService', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let service: DataIngestionService;
    const testLogPath = path.join(process.cwd(), 'test-ingest.log');

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        service = new DataIngestionService(testDb);
        
        // Create a dummy log file
        fs.writeFileSync(testLogPath, 'Test log content\nError: something went wrong');
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
        if (fs.existsSync(testLogPath)) {
            fs.unlinkSync(testLogPath);
        }
    });

    it('should ingest a log file and save it to the database', async () => {
        const result = await service.ingestFile(testLogPath, 'benchmark');
        
        expect(result).toHaveProperty('id');
        expect(result.source).toBe(testLogPath);
        expect(result.type).toBe('log');
        expect(result.content).toBe('Test log content\nError: something went wrong');

        // Verify in DB
        const dbEntry = await testDb.ingestedData.findUnique({
            where: { id: result.id }
        });
        expect(dbEntry).toBeDefined();
        expect(dbEntry?.source).toBe(testLogPath);
    });

    it('should throw an error if the file does not exist', async () => {
        await expect(service.ingestFile('non-existent.log', 'benchmark'))
            .rejects.toThrow();
    });

    it('should ingest and store metadata', async () => {
        const metadata = { version: '1.0', priority: 'high' };
        const result = await service.ingestFile(testLogPath, 'benchmark', metadata);
        
        expect(JSON.parse(result.metadata || '{}')).toEqual(metadata);
    });

    it('should infer type correctly for diff files', async () => {
        const diffPath = path.join(process.cwd(), 'test.diff');
        fs.writeFileSync(diffPath, '--- a/app.ts\n+++ b/app.ts');
        
        const result = await service.ingestFile(diffPath, 'fix-patterns');
        expect(result.type).toBe('diff');
        
        fs.unlinkSync(diffPath);
    });

    it('should fallback to external type for unknown extensions', async () => {
        const otherPath = path.join(process.cwd(), 'test.unknown');
        fs.writeFileSync(otherPath, 'some data');
        
        const result = await service.ingestFile(otherPath, 'external-data');
        expect(result.type).toBe('external');
        
        fs.unlinkSync(otherPath);
    });
});
