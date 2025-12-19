import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SWEBenchIngestionService } from '../../services/SWEBenchIngestionService.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

describe('SWEBenchIngestionService', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let service: SWEBenchIngestionService;
    const testCasesPath = path.join(process.cwd(), 'test-swe-cases.json');

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        service = new SWEBenchIngestionService(testDb);
        
        const testCases = [
            {
                id: "astropy__astropy-12907",
                description: "SWE-bench Lite: astropy/astropy issue",
                repoUrl: "https://github.com/astropy/astropy",
                commitSha: "d16bfe05a744909de4b27f5875fe0d4ed41ce607",
                initialContext: "Problem statement...",
                expectedOutcome: "success",
                patch: "diff --git a/file b/file..."
            }
        ];
        fs.writeFileSync(testCasesPath, JSON.stringify(testCases));
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
        if (fs.existsSync(testCasesPath)) {
            fs.unlinkSync(testCasesPath);
        }
    });

    it('should ingest SWE-bench cases from a JSON file', async () => {
        const results = await service.ingestFromJSON(testCasesPath);
        
        expect(results.length).toBe(1);
        expect(results[0].source).toBe('astropy__astropy-12907');
        expect(results[0].type).toBe('external');
        expect(results[0].content).toContain('Problem statement...');

        // Verify in DB
        const ingested = await testDb.ingestedData.findMany({
            where: { source: 'astropy__astropy-12907' }
        });
        expect(ingested.length).toBe(1);
    });

    it('should also store the patch as a separate diff artifact if present', async () => {
        await service.ingestFromJSON(testCasesPath);
        
        const patchIngested = await testDb.ingestedData.findFirst({
            where: { source: 'astropy__astropy-12907-patch' }
        });
        
        expect(patchIngested).toBeDefined();
        expect(patchIngested?.type).toBe('diff');
        expect(patchIngested?.content).toBe('diff --git a/file b/file...');
    });

    it('should throw an error if the file does not exist', async () => {
        await expect(service.ingestFromJSON('non-existent.json'))
            .rejects.toThrow('File not found: non-existent.json');
    });
});
