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

    describe('Pydantic Version Detection', () => {
        it('should detect Pydantic V2 from model_dump', async () => {
            const content = `
from pydantic import BaseModel
class User(BaseModel):
    name: str
user = User(name="test")
print(user.model_dump())
`;
            const version = (service as any).analyzePydanticVersionRequirement(content);
            expect(version).toBe(2);
        });

        it('should detect Pydantic V1 from dict() usage', async () => {
            const content = `
from pydantic import BaseModel
class User(BaseModel):
    name: str
user = User(name="test")
print(user.dict())
`;
            const version = (service as any).analyzePydanticVersionRequirement(content);
            expect(version).toBe(1);
        });

        it('should detect Pydantic V2 from field_validator', async () => {
            const content = `
from pydantic import BaseModel, field_validator
class User(BaseModel):
    @field_validator('name')
    @classmethod
    def check_name(cls, v):
        return v
`;
            const version = (service as any).analyzePydanticVersionRequirement(content);
            expect(version).toBe(2);
        });

        it('should detect Pydantic V1 from root_validator', async () => {
            const content = `
from pydantic import BaseModel, root_validator
class User(BaseModel):
    @root_validator
    def check_all(cls, values):
        return values
`;
            const version = (service as any).analyzePydanticVersionRequirement(content);
            expect(version).toBe(1);
        });
    });

    describe('Dependency Fix Generation', () => {
        it('should generate fix for requirements.txt', () => {
            const configFiles = [
                { name: 'requirements.txt', content: 'pydantic>=1.10.0\ncrewai==0.1.0' }
            ];
            const fix = service.generateDependencyFix('pydantic', '>=2.0.0', configFiles);
            expect(fix.filePath).toBe('requirements.txt');
            expect(fix.newContent).toContain('pydantic>=2.0.0');
            expect(fix.action).toContain('Pin pydantic to >=2.0.0');
        });

        it('should generate fix for pyproject.toml', () => {
            const configFiles = [
                { name: 'pyproject.toml', content: '[tool.poetry.dependencies]\npython = "^3.10"\npydantic = "^1.10.0"' }
            ];
            const fix = service.generateDependencyFix('pydantic', '>=2.0.0', configFiles);
            expect(fix.filePath).toBe('pyproject.toml');
            expect(fix.newContent).toContain('pydantic = ">=2.0.0"');
        });
    });
});
