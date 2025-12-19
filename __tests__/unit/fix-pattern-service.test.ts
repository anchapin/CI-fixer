import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FixPatternService } from '../../services/FixPatternService.js';
import { TestDatabaseManager } from '../helpers/test-database.js';
import { PrismaClient } from '@prisma/client';

describe('FixPatternService', () => {
    let testDbManager: TestDatabaseManager;
    let testDb: PrismaClient;
    let service: FixPatternService;

    beforeEach(async () => {
        testDbManager = new TestDatabaseManager();
        testDb = await testDbManager.setup();
        service = new FixPatternService(testDb);
    });

    afterEach(async () => {
        if (testDbManager) {
            await testDbManager.teardown();
        }
    });

    it('should extract a fix pattern from original and modified content', async () => {
        const original = 'function add(a, b) {\n  return a + b\n}';
        const modified = 'function add(a, b) {\n  return a + b;\n}'; // added semicolon
        const errorFingerprint = 'semicolon-missing';
        const errorCategory = 'syntax';
        const filePath = 'math.ts';

        const pattern = await service.extractAndSavePattern(
            original,
            modified,
            errorFingerprint,
            errorCategory,
            filePath
        );

        expect(pattern).toBeDefined();
        expect(pattern.errorFingerprint).toBe(errorFingerprint);
        expect(pattern.errorCategory).toBe(errorCategory);
        expect(pattern.filePath).toBe(filePath);
        
        const fixTemplate = JSON.parse(pattern.fixTemplate);
        expect(fixTemplate).toHaveProperty('diff');
        expect(pattern.successCount).toBe(1);
    });

    it('should increment success count if pattern already exists', async () => {
        const original = 'old content';
        const modified = 'new content';
        const fingerprint = 'fingerprint-1';
        
        await service.extractAndSavePattern(original, modified, fingerprint, 'cat', 'file.ts');
        const pattern2 = await service.extractAndSavePattern(original, modified, fingerprint, 'cat', 'file.ts');

        expect(pattern2.successCount).toBe(2);
    });
});
